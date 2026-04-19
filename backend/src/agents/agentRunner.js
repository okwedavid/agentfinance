/**
 * Agent runner — the core agentic loop.
 *
 * Calls Anthropic claude-sonnet with tool-use enabled.
 * Handles the full multi-turn tool-use loop:
 *   1. Send prompt → Claude responds with text or tool_use
 *   2. If tool_use → execute the tool → send result back
 *   3. Repeat until Claude gives a final text response (stop_reason: 'end_turn')
 *
 * Streams progress events via Redis pub/sub so the frontend
 * WebSocket can show live updates.
 */

import Anthropic from '@anthropic-ai/sdk';
import { toolsByAgentType } from '../tools/toolDefinitions.js';
import { executeTool } from '../tools/toolExecutor.js';
import logger from '../utils/logger.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MAX_ITERATIONS = 10; // Safety cap — prevents infinite loops
const MODEL = 'claude-sonnet-4-20250514';

/**
 * Run an agent to completion.
 *
 * @param {object} params
 * @param {string} params.taskId       - Prisma Task ID
 * @param {string} params.agentType    - 'research' | 'trading' | 'content' | 'execution' | 'coordinator'
 * @param {string} params.systemPrompt - Agent's system prompt
 * @param {string} params.userPrompt   - The user's original request
 * @param {string} params.walletAddress- User's connected wallet (injected into context)
 * @param {function} params.onEvent    - Callback for streaming events to frontend
 * @returns {Promise<{result: string, toolsUsed: string[], iterations: number}>}
 */
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

  // Build the initial message — inject wallet context if available
  const contextualPrompt = walletAddress
    ? `${userPrompt}\n\n[Context: User's wallet address is ${walletAddress}. Any earnings should be directed here.]`
    : userPrompt;

  // Conversation history — grows as tools are called
  const messages = [
    { role: 'user', content: contextualPrompt },
  ];

  onEvent?.({ type: 'agent:started', agentType, taskId, timestamp: Date.now() });
  logger.info(`Agent ${agentType} starting for task ${taskId}`);

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    logger.info(`Agent ${agentType} — iteration ${iterations}`);

    // ── Call Anthropic ─────────────────────────────────────────────────────
    let response;
    try {
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools,
        messages,
      });
    } catch (err) {
      logger.error(`Anthropic API error: ${err.message}`);
      throw new Error(`AI call failed: ${err.message}`);
    }

    logger.info(`Agent ${agentType} response — stop_reason: ${response.stop_reason}, blocks: ${response.content.length}`);

    // ── Add assistant response to history ──────────────────────────────────
    messages.push({ role: 'assistant', content: response.content });

    // ── Handle stop reasons ────────────────────────────────────────────────
    if (response.stop_reason === 'end_turn') {
      // Final answer — extract text
      const textBlock = response.content.find(b => b.type === 'text');
      const finalResult = textBlock?.text || 'Agent completed with no text output.';

      onEvent?.({
        type: 'agent:completed',
        agentType,
        taskId,
        result: finalResult,
        toolsUsed,
        iterations,
        timestamp: Date.now(),
      });

      logger.info(`Agent ${agentType} completed after ${iterations} iterations, ${toolsUsed.length} tools used`);
      return { result: finalResult, toolsUsed, iterations };
    }

    if (response.stop_reason === 'tool_use') {
      // Extract all tool_use blocks from this response
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        const { id, name, input } = toolUse;
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

        // Execute the tool
        let toolResult;
        try {
          toolResult = await executeTool(name, input);
        } catch (err) {
          toolResult = `Tool error: ${err.message}`;
          logger.error(`Tool ${name} threw: ${err.message}`);
        }

        onEvent?.({
          type: 'agent:tool_result',
          agentType,
          taskId,
          tool: name,
          result: toolResult,
          timestamp: Date.now(),
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: id,
          content: toolResult,
        });
      }

      // Add all tool results back in a single user message
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Unexpected stop reason
    logger.warn(`Agent ${agentType} unexpected stop_reason: ${response.stop_reason}`);
    break;
  }

  // Hit iteration cap
  const timeoutResult = `Agent reached maximum iterations (${MAX_ITERATIONS}). Partial results may be available.`;
  onEvent?.({ type: 'agent:timeout', agentType, taskId, iterations, timestamp: Date.now() });
  return { result: timeoutResult, toolsUsed, iterations };
}