import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { informationHelp, type HelpId } from "@/lib/information-help";
import { cn } from "@/lib/utils";

export function InformationTooltip({ help, placement = "context", className }: {
  help: HelpId; placement?: "title" | "context"; className?: string;
}) {
  const [touch, setTouch] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.("(hover: none), (pointer: coarse)");
    if (!query) return;
    const update = () => { setTouch(query.matches); setOpen(false); };
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  const content = informationHelp[help];
  const trigger = <button type="button" data-information-help={help}
    aria-label={`Information: ${content.title}`}
    className={cn("inline-flex size-5 shrink-0 touch-manipulation items-center justify-center rounded-full align-middle text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", placement === "title" ? "ml-2" : "ml-1.5", className)}
    onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen((value) => !value); }}>
    <Info className="size-4" aria-hidden="true" />
  </button>;
  const body = <div className="space-y-1.5 text-left text-xs font-normal normal-case leading-5 tracking-normal">
    <p className="font-semibold">{content.title}</p>
    <p>{content.purpose}</p><p>{content.instructions}</p>
    {content.rules && <p><strong>Rules: </strong>{content.rules}</p>}
    {content.example && <p><strong>Example: </strong>{content.example}</p>}
    <p><strong>Next: </strong>{content.next}</p>
  </div>;
  const styles = "z-[100] w-80 max-w-[calc(100vw-2rem)] max-h-[min(26rem,70dvh)] overflow-y-auto whitespace-normal break-words rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg";
  if (touch) return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
    <PopoverContent role="tooltip" aria-label={content.title} side="bottom" align="center" collisionPadding={16}
      onOpenAutoFocus={(event) => event.preventDefault()} className={styles}>{body}</PopoverContent>
  </Popover>;
  return <TooltipProvider delayDuration={250}><Tooltip open={open} onOpenChange={setOpen}>
    <TooltipTrigger asChild>{trigger}</TooltipTrigger>
    <TooltipContent side="bottom" align="center" collisionPadding={16} sideOffset={8} className={styles}>{body}</TooltipContent>
  </Tooltip></TooltipProvider>;
}
