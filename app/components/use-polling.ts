import { useEffect } from "react";
import { useRevalidator } from "react-router";

export function usePolling(active: boolean, ms: number) {
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, ms);
    return () => clearInterval(timer);
  }, [active, ms, revalidator]);
}
