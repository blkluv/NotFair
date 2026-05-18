import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { ClientMountGate } from "@/components/client-mount-gate";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMountGate
      fallback={
        <div className="min-h-screen bg-background" suppressHydrationWarning>
          {/* Empty shell during hydration — children mount client-side */}
        </div>
      }
    >
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <a href="#main-content" className="sr-only focus:not-sr-only">
              Skip to content
            </a>
          </header>
          <main id="main-content" className="relative flex-1 p-6">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </ClientMountGate>
  );
}
