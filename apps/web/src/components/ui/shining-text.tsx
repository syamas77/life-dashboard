"use client";

import { motion, useReducedMotion } from "motion/react";

type ShiningTextProps = {
  text: string;
  className?: string;
};

export function ShiningText({ text, className = "" }: ShiningTextProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.span
      className={`inline-block bg-[linear-gradient(110deg,var(--muted),35%,var(--ink),50%,var(--muted),75%,var(--muted))] bg-[length:200%_100%] bg-clip-text text-transparent ${className}`}
      initial={reduceMotion ? { backgroundPosition: "0% 0" } : { backgroundPosition: "200% 0" }}
      animate={reduceMotion ? { backgroundPosition: "0% 0" } : { backgroundPosition: "-200% 0" }}
      transition={reduceMotion ? { duration: 0 } : { repeat: Infinity, duration: 2.4, ease: "linear" }}
    >
      {text}
    </motion.span>
  );
}
