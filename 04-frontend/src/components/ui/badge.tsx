import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-medium leading-4 transition-colors duration-150",
  {
    variants: {
      variant: {
        default:
          "border-primary/25 bg-primary/12 text-accent-foreground dark:bg-primary/14",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        success:
          "border-success/20 bg-success/8 text-success dark:bg-success/14",
        destructive:
          "border-destructive/20 bg-destructive/8 text-destructive dark:bg-destructive/16",
        warning:
          "border-warning-foreground/35 bg-transparent font-semibold text-warning-foreground dark:border-warning/40 dark:text-warning",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
