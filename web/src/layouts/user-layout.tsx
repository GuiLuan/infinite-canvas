import { useSyncExternalStore, type ReactNode } from "react";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { useAgentStore } from "@/stores/use-agent-store";

const agentOverlay = window.matchMedia("(width < 80rem)");

function subscribeToAgentOverlay(onChange: () => void) {
    agentOverlay.addEventListener("change", onChange);
    return () => agentOverlay.removeEventListener("change", onChange);
}

export default function UserLayout({ children }: { children: ReactNode }) {
    const isOverlay = useSyncExternalStore(subscribeToAgentOverlay, () => agentOverlay.matches);
    const agentOpen = useAgentStore((state) => state.panelOpen);

    return (
        <div className="relative flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="max-xl:isolate flex min-w-0 flex-1 flex-col overflow-hidden" inert={isOverlay && agentOpen}>
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <AgentPanel />
        </div>
    );
}
