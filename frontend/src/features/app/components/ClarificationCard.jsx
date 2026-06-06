import { Button } from "@/components/ui/button";

export function ClarificationCard({ item, isBusy, onAnswer }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[94%] rounded-2xl border border-[#D4E1F0] bg-card px-4 py-4 sm:max-w-[92%]">
        <p className="text-xs text-primary">Perlu klarifikasi</p>
        <p className="mt-1 text-sm text-foreground">{item.data.question}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {item.data.options.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="default"
              disabled={isBusy}
              onClick={() => onAnswer(item, option.value)}
              className="px-4 py-2.5"
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
