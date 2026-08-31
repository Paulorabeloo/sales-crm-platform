"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, LoadingState } from "@/components/shared/states";
import { useCreateTask, useToggleTask } from "@/hooks/mutations";
import { useDealTasks } from "@/hooks/queries";
import { taskSchema, type TaskInput } from "@/lib/schemas";
import { t } from "@/lib/strings";
import { cn, formatDate, todayISO } from "@/lib/utils";

function NewTaskDialog({ dealId }: { dealId: string }) {
  const [open, setOpen] = React.useState(false);
  const createTask = useCreateTask(dealId);
  const form = useForm<TaskInput>({
    resolver: zodResolver(taskSchema),
    defaultValues: { title: "", due_date: todayISO() },
  });

  function onSubmit(values: TaskInput) {
    createTask.mutate(values, {
      onSuccess: () => {
        setOpen(false);
        form.reset({ title: "", due_date: todayISO() });
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-4" />
          {t.deal.createTask}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.tasks.newTaskTitle}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-title">{t.tasks.taskTitleLabel}</Label>
            <Input
              id="task-title"
              placeholder={t.tasks.taskTitlePlaceholder}
              {...form.register("title")}
            />
            {form.formState.errors.title && (
              <p className="text-xs text-destructive">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-due">{t.tasks.dueDateLabel}</Label>
            <Input id="task-due" type="date" {...form.register("due_date")} />
            {form.formState.errors.due_date && (
              <p className="text-xs text-destructive">
                {form.formState.errors.due_date.message}
              </p>
            )}
          </div>
          <Button type="submit" disabled={createTask.isPending}>
            {createTask.isPending ? t.common.saving : t.common.create}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DealTasks({ dealId }: { dealId: string }) {
  const tasksQuery = useDealTasks(dealId);
  const toggleTask = useToggleTask();

  const tasks = tasksQuery.data ?? [];
  const today = todayISO();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t.deal.tasksTitle}</CardTitle>
        <NewTaskDialog dealId={dealId} />
      </CardHeader>
      <CardContent>
        {tasksQuery.isLoading ? (
          <LoadingState />
        ) : tasks.length === 0 ? (
          <EmptyState message={t.deal.tasksEmpty} />
        ) : (
          <ul className="flex flex-col gap-2">
            {tasks.map((task) => {
              const overdue = !task.is_done && task.due_date < today;
              return (
                <li
                  key={task.id}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2"
                >
                  <Checkbox
                    checked={task.is_done}
                    aria-label={t.tasks.markDone}
                    onCheckedChange={(checked) =>
                      toggleTask.mutate({
                        taskId: task.id,
                        isDone: checked === true,
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm",
                        task.is_done && "text-muted-foreground line-through",
                      )}
                    >
                      {task.title}
                    </p>
                    <p
                      className={cn(
                        "text-xs",
                        overdue
                          ? "font-medium text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {t.tasks.dueOn(formatDate(task.due_date))}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
