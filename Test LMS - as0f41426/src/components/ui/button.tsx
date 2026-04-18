import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:     "bg-[var(--c-btn-primary)] text-[var(--c-btn-primary-fg)] hover:bg-[var(--c-btn-primary-hover)]",
        destructive: "bg-red-600 text-white hover:bg-red-700",
        outline:     "border border-[#e8e8e8] bg-white hover:bg-[#f4f4f4] text-[var(--foreground)]",
        ghost:       "hover:bg-[#f4f4f4] text-[var(--foreground)]",
        secondary:   "bg-[#f4f4f4] text-[var(--foreground)] hover:bg-[#e8e8e8]",
        success:     "bg-[var(--c-success)] text-[var(--c-success-fg)] font-semibold hover:bg-[var(--c-success-hover)]",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm:      "h-8 rounded-md px-3 text-xs",
        lg:      "h-11 rounded-md px-8 text-base",
        icon:    "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
