const {
  isAffirmativeConfirmation,
  pendingConfirmationToToolCall,
} = require("../../src/agent/pendingConfirmationResolver");

describe("pendingConfirmationResolver", () => {
  it("detects affirmative confirmations", () => {
    expect(isAffirmativeConfirmation("yes, create it")).toBe(true);
    expect(isAffirmativeConfirmation("create it")).toBe(true);
    expect(isAffirmativeConfirmation("yes, apply it")).toBe(true);
    expect(isAffirmativeConfirmation("apply it")).toBe(true);
    expect(isAffirmativeConfirmation("yes")).toBe(true);
    expect(isAffirmativeConfirmation("go ahead")).toBe(true);
  });

  it("rejects non-confirm messages", () => {
    expect(isAffirmativeConfirmation("create a goal to study JS")).toBe(false);
    expect(isAffirmativeConfirmation("maybe later")).toBe(false);
  });

  it("maps confirm_goal_plan pending to tool call", () => {
    const call = pendingConfirmationToToolCall({
      type: "confirm_goal_plan",
      goalId: "goal_abc123",
      goalTitle: "Study JS",
      itemCount: 8,
    });
    expect(call).toEqual({
      toolName: "confirm_goal_plan",
      toolArgs: { goalId: "goal_abc123", confirmed: true },
    });
  });

  it("maps delete_task pending to tool call", () => {
    const call = pendingConfirmationToToolCall({
      type: "delete_task",
      taskId: "task_1",
      taskTitle: "Groceries",
    });
    expect(call).toEqual({
      toolName: "delete_task",
      toolArgs: { taskId: "task_1", confirmed: true },
    });
  });

  it("maps apply_goal_adjustment pending to tool call", () => {
    const call = pendingConfirmationToToolCall({
      type: "apply_goal_adjustment",
      goalId: "goal_1",
      goalTitle: "Anatomy",
      itemCount: 5,
      deadline: "2026-07-10",
      spreadEvenly: true,
    });
    expect(call).toEqual({
      toolName: "apply_goal_adjustment",
      toolArgs: {
        goalId: "goal_1",
        confirmed: true,
        deadline: "2026-07-10",
        spreadEvenly: true,
      },
    });
  });

  it("maps apply_goal_rebalance pending to tool call", () => {
    const call = pendingConfirmationToToolCall({
      type: "apply_goal_rebalance",
      goalId: "goal_1",
      goalTitle: "JavaScript",
      changeCount: 2,
    });
    expect(call).toEqual({
      toolName: "apply_goal_rebalance",
      toolArgs: { goalId: "goal_1", confirmed: true },
    });
  });
});
