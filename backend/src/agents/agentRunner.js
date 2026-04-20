/**
 * agentRunner.js — Groq-powered agentic loop
 *
 * KEY DIFFERENCES from Anthropic format:
 * - Uses groq-sdk (OpenAI-compatible)
 * - Tool calls come in: response.choices[0].message.tool_calls[]
 * - Each tool call: { id, type: "function", function: { name, arguments } }
 * - arguments is a JSON STRING — must JSON.parse() it
 * - Tool results go back as: { role: "tool", tool_call_id: id, content: string }
 * - stop_reason is: response.choices[0].finish_reason ("stop" | "tool_calls")
 * - Tool schema: { type: "function", function: { name, description, parameters } }
 */

import Groq from 'groq-sdk';
import { toolsByAgentType } from '../tools/toolDefinitions.js';
import { executeTool } from '../tools/toolExecutor.js';
import logger from '../utils/logger.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Best Groq model for tool use — fast and capable
const MODEL = 'llama-3.3-70b-versatile';
const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 10;

export async function runAgent({
  taskId,
  agentType,
  systemPrompt,
  userPrompt,
  walletAddress,
  onEvent,
}) {
  const tools = toolsByAgentType[agentType] || toolsByAgentType.research;
  const toolsUsed = [];
  let iterations = 0;

  const contextPrompt = walletAddress
    ? `${userPrompt}\n\n[User crypto wallet: ${walletAddress} — route all earnings here]`
    : userPrompt;

  // Groq/OpenAI message format
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: contextPrompt },
  ];

  onEvent?.({ type: 'agent:started', agentType, taskId, timestamp: Date.now() });
  logger.info(`[Agent:${agentType}] Starting task ${taskId} — model: ${MODEL}`);

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    let response;
    try {
      response = await groq.chat.completions.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0.1, // Low temp for reliable tool calling
        messages,
        tools,
        tool_choice: 'auto',
      });
    } catch (err) {
      const detail = err.message || String(err);
      logger.error(`[Agent:${agentType}] Groq API error iter=${iterations}: ${detail}`);
      throw new Error(`AI call failed: ${detail}`);
    }

    const choice = response.choices[0];
    const { finish_reason, message } = choice;

    logger.info(`[Agent:${agentType}] iter=${iterations} finish_reason=${finish_reason}`);

    // Add assistant message to history
    messages.push(message);

    if (finish_reason === 'stop' || finish_reason === 'length') {
      // Final text answer
      const result = message.content || 'Agent completed with no text output.';

      onEvent?.({
        type: 'agent:completed',
        agentType,
        taskId,
        result,
        toolsUsed,
        iterations,
        timestamp: Date.now(),
      });

      logger.info(`[Agent:${agentType}] Done. ${iterations} iters, tools: ${toolsUsed.join(', ') || 'none'}`);
      return { result, toolsUsed, iterations };
    }

    if (finish_reason === 'tool_calls') {
      const toolCalls = message.tool_calls || [];

      for (const toolCall of toolCalls) {
        const { id, function: fn } = toolCall;
        const name = fn.name;

        // Arguments is a JSON string — MUST parse
        let args = {};
        try {
          args = JSON.parse(fn.arguments || '{}');
        } catch (e) {
          logger.error(`[Agent:${agentType}] Failed to parse tool args for ${name}: ${fn.arguments}`);
          args = {};
        }

        toolsUsed.push(name);
        onEvent?.({ type: 'agent:tool_call', agentType, taskId, tool: name, input: args, timestamp: Date.now() });
        logger.info(`[Agent:${agentType}] Calling tool: ${name} with ${JSON.stringify(args).slice(0, 100)}`);

        let toolResult;
        try {
          toolResult = await executeTool(name, args);
        } catch (err) {
          toolResult = `Tool "${name}" error: ${err.message}`;
          logger.error(`[Agent:${agentType}] Tool ${name} threw: ${err.message}`);
        }

        onEvent?.({ type: 'agent:tool_result', agentType, taskId, tool: name, result: toolResult, timestamp: Date.now() });

        // Tool result goes back as role: "tool" with tool_call_id
        messages.push({
          role: 'tool',
          tool_call_id: id,
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
        });
      }

      continue; // Loop back to get next response
    }

    // Unexpected finish_reason
    logger.warn(`[Agent:${agentType}] Unexpected finish_reason: ${finish_reason}`);
    const result = message.content || `Agent stopped with reason: ${finish_reason}`;
    onEvent?.({ type: 'agent:completed', agentType, taskId, result, toolsUsed, iterations, timestamp: Date.now() });
    return { result, toolsUsed, iterations };
  }

  const timeoutResult = `Agent reached maximum iterations (${MAX_ITERATIONS}). Last response may be partial.`;
  onEvent?.({ type: 'agent:timeout', agentType, taskId, iterations, timestamp: Date.now() });
  return { result: timeoutResult, toolsUsed, iterations };
}