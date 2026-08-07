import { SessionToolbox } from "@/components/tools/SessionToolbox";
export default function ToolboxPreview() {
  return (
    <div className="mx-auto max-w-[720px] bg-background p-6">
      <SessionToolbox sessionId="00000000-0000-0000-0000-000000000000" />
    </div>
  );
}
