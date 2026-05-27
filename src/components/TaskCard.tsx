"use client";

import type { ApiTask } from "@/types";

type Props = {
  task: ApiTask;
  onClick?: (task: ApiTask) => void;
};

/** Returns the display state for a due date relative to today. */
function getDueDateState(dueDate: string): "overdue" | "today" | "upcoming" {
  const due = new Date(dueDate);
  const today = new Date();
  // Compare calendar dates only (strip time)
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (dueDay < todayDay) return "overdue";
  if (dueDay.getTime() === todayDay.getTime()) return "today";
  return "upcoming";
}

export function TaskCard({ task, onClick }: Props) {
  const dueDateState = task.dueDate ? getDueDateState(task.dueDate) : null;

  return (
    <button
      type="button"
      onClick={() => onClick?.(task)}
      className="w-full text-left bg-bg border border-border rounded-md p-3 hover:border-accent transition"
    >
      <p className="text-sm font-medium leading-snug mb-2">{task.title}</p>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {task.assignee ? task.assignee.name : "unassigned"}
        </span>

        {/* Due date badge */}
        {task.dueDate && dueDateState === "overdue" && (
          <span className="bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded text-xs font-medium">
            overdue
          </span>
        )}
        {task.dueDate && dueDateState === "today" && (
          <span className="bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded text-xs font-medium">
            due today
          </span>
        )}
        {task.dueDate && dueDateState === "upcoming" && (
          <span className="text-muted text-xs">
            {new Date(task.dueDate).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
      </div>
    </button>
  );
}
