import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useAppStore } from '../store/useAppStore';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { sidebarCollapsed, darkMode } = useAppStore();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${sidebarCollapsed ? 'ml-[68px]' : 'ml-[240px]'}`}>
        <Header />
        <main className={`flex-1 overflow-y-auto p-6 ${darkMode ? 'bg-dark-950' : 'bg-gray-50'}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
