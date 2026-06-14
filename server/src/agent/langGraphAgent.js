const { StateGraph, START, END, Annotation } = require("@langchain/langgraph");
const { completeAgentTurn } = require("./llmClient");
const { isV1ToolName, parseToolArgs } = require("./tools");
const { listTasksArgsForTodayIntent } = require("./ruleParser");
const {
  isAffirmativeConfirmation,
  pendingConfirmationToToolCall,
} = require("./pendingConfirmationResolver");
const {
  collectClientActions,
  assistantMessageAfterToolExecution,
  executeToolChain,
  extractPendingConfirmation,
} = require("./chatOrchestrator");

const AgentState = Annotation.Root({
  userId: Annotation({ reducer: (_, value) => value, default: () => "" }),
  message: Annotation({ reducer: (_, value) => value, default: () => "" }),
  history: Annotation({ reducer: (_, value) => value, default: () => [] }),
  pendingConfirmation: Annotation({
    reducer: (_, value) => value,
    default: () => null,
  }),
  tzOffsetMinutes: Annotation({
    reducer: (_, value) => value,
    default: () => 0,
  }),
  nextStep: Annotation({ reducer: (_, value) => value, default: () => "" }),
  directToolCall: Annotation({
    reducer: (_, value) => value,
    default: () => null,
  }),
  toolName: Annotation({ reducer: (_, value) => value, default: () => null }),
  toolArgs: Annotation({ reducer: (_, value) => value, default: () => null }),
  toolResults: Annotation({ reducer: (_, value) => value, default: () => [] }),
  responsePendingConfirmation: Annotation({
    reducer: (_, value) => value,
    default: () => null,
  }),
  assistantMessage: Annotation({
    reducer: (_, value) => value,
    default: () => null,
  }),
  clientActions: Annotation({ reducer: (_, value) => value, default: () => [] }),
});

function clarificationMessage(detail) {
  if (/title/i.test(detail)) {
    return "What should the task be called?";
  }
  if (/dueDate|due date|date/i.test(detail)) {
    return "When is this task due? Please include a date and time (for example, tomorrow at 11am).";
  }
  return `I need a bit more detail: ${detail}`;
}

async function prepareContextNode(state) {
  if (!state.userId || !String(state.message ?? "").trim()) {
    return {
      assistantMessage: "I need a valid message to continue.",
      toolResults: [],
      responsePendingConfirmation: null,
      clientActions: [],
      nextStep: "finalize",
    };
  }
  return { nextStep: "resolve_pending" };
}

async function resolvePendingConfirmationNode(state) {
  if (isAffirmativeConfirmation(state.message)) {
    const directCall = pendingConfirmationToToolCall(state.pendingConfirmation);
    if (directCall) {
      return {
        directToolCall: directCall,
        toolName: directCall.toolName,
        toolArgs: directCall.toolArgs,
        nextStep: "execute_tool",
      };
    }
  }

  return {
    directToolCall: null,
    nextStep: "call_model",
  };
}

async function callModelNode(state) {
  const llmResult = await completeAgentTurn({
    message: state.message,
    tzOffsetMinutes: state.tzOffsetMinutes,
    history: state.history,
  });

  if (llmResult.type === "message") {
    return {
      assistantMessage:
        llmResult.content ||
        "How can I help with your tasks, focus session, or goal plan?",
      toolResults: [],
      responsePendingConfirmation: null,
      clientActions: [],
      nextStep: "finalize",
    };
  }

  const toolName = llmResult.toolName;
  if (!isV1ToolName(toolName)) {
    return {
      assistantMessage:
        "I can help with tasks, focus sessions, and goals — including creating goals, previewing plans, and confirming schedules.",
      toolResults: [],
      responsePendingConfirmation: null,
      clientActions: [],
      nextStep: "finalize",
    };
  }

  const parsed = parseToolArgs(toolName, llmResult.rawArgs);
  if (!parsed.ok) {
    return {
      assistantMessage: clarificationMessage(parsed.error),
      toolResults: [],
      responsePendingConfirmation: null,
      clientActions: [],
      nextStep: "finalize",
    };
  }

  let toolArgs = parsed.args;
  if (toolName === "list_tasks") {
    toolArgs = listTasksArgsForTodayIntent(
      state.message,
      state.tzOffsetMinutes,
      parsed.args
    );
  }

  return {
    toolName,
    toolArgs,
    nextStep: "execute_tool",
  };
}

async function executeToolNode(state) {
  const ctx = {
    userId: state.userId,
    tzOffsetMinutes: state.tzOffsetMinutes,
  };
  const toolName = state.directToolCall?.toolName ?? state.toolName;
  const toolArgs = state.directToolCall?.toolArgs ?? state.toolArgs;

  const toolResults = await executeToolChain(ctx, toolName, toolArgs);
  const responsePendingConfirmation = extractPendingConfirmation(toolResults);

  return {
    toolResults,
    toolName,
    toolArgs,
    responsePendingConfirmation,
    nextStep: "observe_and_respond",
  };
}

async function observeAndRespondNode(state) {
  const assistantMessage = await assistantMessageAfterToolExecution({
    message: state.message,
    tzOffsetMinutes: state.tzOffsetMinutes,
    toolName: state.toolName,
    args: state.toolArgs,
    toolResults: state.toolResults,
  });

  return {
    assistantMessage,
    clientActions: collectClientActions(state.toolResults),
    nextStep: "finalize",
  };
}

async function finalizeNode(state) {
  return {
    assistantMessage:
      state.assistantMessage ||
      "How can I help with your tasks, focus session, or goal plan?",
    clientActions:
      state.clientActions?.length > 0
        ? state.clientActions
        : collectClientActions(state.toolResults ?? []),
    nextStep: "done",
  };
}

function routeByNextStep(state) {
  return state.nextStep || "finalize";
}

/** @type {import("@langchain/langgraph").CompiledStateGraph | null} */
let compiledGraph = null;

function buildAgentGraph() {
  const graph = new StateGraph(AgentState)
    .addNode("prepareContext", prepareContextNode)
    .addNode("resolvePendingConfirmation", resolvePendingConfirmationNode)
    .addNode("callModel", callModelNode)
    .addNode("executeTool", executeToolNode)
    .addNode("observeAndRespond", observeAndRespondNode)
    .addNode("finalize", finalizeNode)
    .addEdge(START, "prepareContext")
    .addConditionalEdges("prepareContext", routeByNextStep, {
      resolve_pending: "resolvePendingConfirmation",
      finalize: "finalize",
    })
    .addConditionalEdges("resolvePendingConfirmation", routeByNextStep, {
      execute_tool: "executeTool",
      call_model: "callModel",
    })
    .addConditionalEdges("callModel", routeByNextStep, {
      execute_tool: "executeTool",
      finalize: "finalize",
    })
    .addEdge("executeTool", "observeAndRespond")
    .addEdge("observeAndRespond", "finalize")
    .addEdge("finalize", END);

  return graph.compile();
}

function getCompiledAgentGraph() {
  if (!compiledGraph) {
    compiledGraph = buildAgentGraph();
  }
  return compiledGraph;
}

function resetCompiledAgentGraphForTests() {
  compiledGraph = null;
}

/**
 * @param {{
 *   userId: string,
 *   message: string,
 *   history?: Array<{role: string, text: string}>,
 *   pendingConfirmation?: object | null,
 *   tzOffsetMinutes?: number,
 * }} input
 */
async function runLangGraphAgent({
  userId,
  message,
  history = [],
  pendingConfirmation = null,
  tzOffsetMinutes = 0,
}) {
  const graph = getCompiledAgentGraph();
  const finalState = await graph.invoke({
    userId,
    message,
    history,
    pendingConfirmation,
    tzOffsetMinutes,
  });

  return {
    assistantMessage: finalState.assistantMessage,
    toolResults: finalState.toolResults ?? [],
    pendingConfirmation: finalState.responsePendingConfirmation ?? null,
    clientActions:
      finalState.clientActions?.length > 0
        ? finalState.clientActions
        : collectClientActions(finalState.toolResults ?? []),
  };
}

module.exports = {
  AgentState,
  buildAgentGraph,
  getCompiledAgentGraph,
  resetCompiledAgentGraphForTests,
  runLangGraphAgent,
  prepareContextNode,
  resolvePendingConfirmationNode,
  callModelNode,
  executeToolNode,
  observeAndRespondNode,
  finalizeNode,
};
