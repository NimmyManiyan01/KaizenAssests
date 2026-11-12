import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function badgeText(children: React.ReactNode): string {
  return React.Children.toArray(children).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (React.isValidElement<{ children?: React.ReactNode }>(child)) return badgeText(child.props.children);
    return "";
  }).join(" ");
}

function statusTone(value: string): "positive" | "negative" | undefined {
  const status = value.trim().replaceAll("_", " ").replaceAll("-", " ").replace(/\s+/g, " ").toUpperCase();
  if (/\b(INACTIVE|REJECTED|REJECT|FAILED|FAILURE|CANCELLED|CANCELED|BLOCKED|DISABLED|DAMAGED|ERROR|DENIED|EXPIRED|DELETED|RETURNED|DELAYED)\b/.test(status)) return "negative";
  if (/\b(SUBMITTED|ACTIVE|APPROVED|ACCEPTED|COMPLETED|COMPLETE|SUCCESS|SUCCESSFUL|PASSED|AVAILABLE|READY|DELIVERED|CLOSED|POSTED|VERIFIED|RESOLVED|CLEARED)\b/.test(status)) return "positive";
  return undefined;
}

function Badge({ className, variant, children, ...props }: BadgeProps) {
  const status = String((props as Record<string, unknown>)["data-status"] ?? badgeText(children));
  return <div data-slot="badge" data-status-tone={statusTone(status)} className={cn(badgeVariants({ variant }), className)} {...props}>{children}</div>;
}

export { Badge, badgeVariants };
