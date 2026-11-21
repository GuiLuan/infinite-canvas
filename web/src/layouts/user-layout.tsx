import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { eagleAgentRequestUrl } from "@/services/api/eagle";

const agentOverlay = window.matchMedia("(width < 80rem)");

function subscribeToAgentOverlay(onChange: () => void) {
    agentOverlay.addEventListener("change", onChange);
    return () => agentOverlay.removeEventListener("change", onChange);
}

export default function UserLayout({ children }: { children: ReactNode }) {
    const isOverlay = useSyncExternalStore(subscribeToAgentOverlay, () => agentOverlay.matches);
    const agentOpen = useAgentStore((state) => state.panelOpen);
    const navigate = useNavigate();

    useEffect(() => {
        const events = new EventSource(eagleAgentRequestUrl("/canvas/events"));
        events.onmessage = (event) => {
            try {
                const { projectId, nodeId } = JSON.parse(event.data) as { projectId: string; nodeId: string };
                const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
                if (!project?.nodes.some((node) => node.id === nodeId)) return;
                const query = new URLSearchParams({ node: nodeId, open: crypto.randomUUID() });
                navigate(`/canvas/${encodeURIComponent(projectId)}?${query}`);
                window.focus();
            } catch (error) {
                console.error("无法打开 Eagle 画布链接", error);
            }
        };
        return () => events.close();
    }, [navigate]);

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
