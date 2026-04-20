import Groq from "groq-sdk";
import { toolsByAgentType } from '../tools/toolDefinitions.js';
import { executeTool } from '../tools/toolExecutor.js';
import logger from '../utils/logger.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MAX_ITERATIONS = 10; 
const MODEL = 'llama-3.3-70b-versatile';

export async function runAgent({
  taskId,
  agentType,
  systemPrompt,
  userPrompt,
  walletAddress,
  onEvent,
}) {
  const tools = toolsByAgentType[agentType] || toolsByAgentType.coordinator;
  const toolsUsed = [];
  let iterations = 0;

  const contextualPrompt = walletAddress
    ? `${userPrompt}\n\n[Context: User's wallet address is ${walletAddress}. Any earnings should be directed here.]`
    : userPrompt;

  // History starts with the user prompt
  const messages = [
    { role: 'user', content: contextualPrompt },
  ];

  onEvent?.({ type: 'agent:started', agentType, taskId, timestamp: Date.now() });
  logger.info(`Agent ${agentType} starting for task ${taskId}`);

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    logger.info(`Agent ${agentType} — iteration ${iterations}`);

    let response;
    try {
      response = await groq.chat.completions.create({
        model: MODEL,
        max_tokens: 4096,
        // System prompt is inside the messages array for Groq
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        tools,
        tool_choice: "auto",
      });
    } catch (err) {
      logger.error(`Groq API error: ${err.message}`);
      throw new Error(`AI call failed: ${err.message}`);
    }

    const assistantMessage = response.choices[0].message;
    const toolCalls = assistantMessage.tool_calls;

    // Add Groq's assistant message to history
    messages.push(assistantMessage);

    // ── CASE 1: Final Answer (No Tool Calls) ──────────────────────────────
    if (!toolCalls || toolCalls.length === 0) {
      const finalResult = assistantMessage.content || 'Agent completed with no text output.';

      onEvent?.({
        type: 'agent:completed',
        agentType,
        taskId,
        result: finalResult,
        toolsUsed,
        iterations,
        timestamp: Date.now(),
      });

      logger.info(`Agent ${agentType} completed after ${iterations} iterations`);
      return { result: finalResult, toolsUsed, iterations };
    }

    // ── CASE 2: Tool Use ──────────────────────────────────────────────────
    if (toolCalls && toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        const { id, function: { name, arguments: argsString } } = toolCall;
        const input = JSON.parse(argsString); // Groq sends arguments as a string
        toolsUsed.push(name);

        onEvent?.({
          type: 'agent:tool_call',
          agentType,
          taskId,
          tool: name,
          input,
          timestamp: Date.now(),
        });

        logger.info(`Agent ${agentType} calling tool: ${name}`);

        let toolResult;
        try {
          toolResult = await executeTool(name, input);
        } catch (err) {
          toolResult = `Tool error: ${err.message}`;
          logger.error(`Tool ${name} threw: ${err.message}`);
        }

        // Stringify tool result if it's an object (Groq expects strings/JSON)
        const content = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);

        onEvent?.({
          type: 'agent:tool_result',
          agentType,
          taskId,
          tool: name,
          result: content,
          timestamp: Date.now(),
        });

        // Add the tool response back to the conversation
        messages.push({
          role: 'tool',
          tool_call_id: id,
          name: name,
          content: content,
        });
      }
      // Continue loop to let the AI process the tool results
      continue;
    }

    break;
  }

  const timeoutResult = `Agent reached maximum iterations (${MAX_ITERATIONS}).`;
  onEvent?.({ type: 'agent:timeout', agentType, taskId, iterations, timestamp: Date.now() });
  return { result: timeoutResult, toolsUsed, iterations };
}
