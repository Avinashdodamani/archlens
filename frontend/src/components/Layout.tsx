import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import CommandPalette from './CommandPalette';
import AiAssistant from './AiAssistant';
import OnboardingTour from './OnboardingTour';
import ErrorBoundary from './ErrorBoundary';
import { useAppStore } from '../store/useAppStore';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { sidebarCollapsed, darkMode } = useAppStore();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Global command palette (Cmd/Ctrl+K), AI assistant bubble, first-run tour */}
      <CommandPalette />
      <AiAssistant />
      <OnboardingTour />
      <Sidebar />
      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${sidebarCollapsed ? 'ml-[68px]' : 'ml-[240px]'}`}>
        <Header />
        <main className={`flex-1 overflow-y-auto p-6 ${darkMode ? 'bg-dark-950' : 'bg-dark-50'}`}>
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
