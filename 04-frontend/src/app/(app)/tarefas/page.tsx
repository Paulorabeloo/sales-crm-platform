"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CalendarDays, ExternalLink, Sun } from "lucide-react";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToggleTask } from "@/hooks/mutations";
import { useMyTasks } from "@/hooks/queries";
import { errorMessage } from "@/lib/api/client";
import type { TaskItem } from "@/lib/api/types";
import { t } from "@/lib/strings";
import { cn, formatDate } from "@/lib/utils";

function TaskRow({ task, overdue }: { task: TaskItem; overdue: boolean }) {
  const toggleTask = useToggleTask();
  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
      <Checkbox
        checked={task.is_done}
        aria-label={t.tasks.markDone}
        onCheckedChange={(checked) =>
          toggleTask.mutate({ taskId: task.id, isDone: checked === true })
        }
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{task.title}</p>
        <p
          className={cn(
            "text-xs",
            overdue ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {t.tasks.dueOn(formatDate(task.due_date))}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 gap-1 text-muted-foreground"
        asChild
      >
        <Link href={`/negociacoes/${task.deal_id}`}>
          <ExternalLink className="size-3.5" />
          <span className="hidden sm:inline">{t.tasks.openDeal}</span>
        </Link>
      </Button>
    </li>
  );
}

function TaskGroup({
  title,
  icon: Icon,
  tasks,
  overdue = false,
  highlight = false,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tasks: TaskItem[];
  overdue?: boolean;
  highlight?: boolean;
}) {
  return (
    <Card className={cn(highlight && "border-destructive/40")}>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <Icon
          className={cn(
            "size-4",
            highlight ? "text-destructive" : "text-muted-foreground",
          )}
        />
        <CardTitle className="text-base">
          {title}
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {tasks.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {t.tasks.emptyGroup}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} overdue={overdue} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function TasksPage() {
  // GET /tasks/my already buckets pending tasks server-side.
  const tasksQuery = useMyTasks();
  const overdue = tasksQuery.data?.overdue ?? [];
  const dueToday = tasksQuery.data?.today ?? [];
  const upcoming = tasksQuery.data?.upcoming ?? [];
  const pending = [...overdue, ...dueToday, ...upcoming];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">{t.tasks.title}</h1>

      {tasksQuery.isLoading ? (
        <LoadingState />
      ) : tasksQuery.isError ? (
        <ErrorState
          message={errorMessage(tasksQuery.error)}
          onRetry={() => void tasksQuery.refetch()}
        />
      ) : pending.length === 0 ? (
        <EmptyState message={t.tasks.empty} />
      ) : (
        <>
          <TaskGroup
            title={t.tasks.overdue}
            icon={AlertTriangle}
            tasks={overdue}
            overdue
            highlight={overdue.length > 0}
          />
          <TaskGroup title={t.tasks.today} icon={Sun} tasks={dueToday} />
          <TaskGroup
            title={t.tasks.upcoming}
            icon={CalendarDays}
            tasks={upcoming}
          />
        </>
      )}
    </div>
  );
}
