import { useState } from 'react';
import { ClipboardDocumentIcon, ArrowDownTrayIcon, CheckIcon } from '@heroicons/react/24/outline';

interface ScriptViewerProps {
  title: string;
  content: string;
  language: string;
  downloadUrl?: string;
  filename?: string;
}

export default function ScriptViewer({ title, content, language, downloadUrl, filename }: ScriptViewerProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownloadLocal() {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `${title.toLowerCase().replace(/\s/g, '-')}.${language === 'yaml' ? 'yaml' : 'tf'}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="border border-dark-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-dark-800 border-b border-dark-700">
        <span className="text-sm font-medium text-gray-300">{title}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="p-1.5 text-gray-400 hover:text-white rounded transition-colors"
            title="Copy to clipboard"
          >
            {copied ? <CheckIcon className="w-4 h-4 text-green-400" /> : <ClipboardDocumentIcon className="w-4 h-4" />}
          </button>
          {downloadUrl ? (
            <a
              href={downloadUrl}
              className="p-1.5 text-gray-400 hover:text-white rounded transition-colors"
              title="Download from S3"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
            </a>
          ) : (
            <button
              onClick={handleDownloadLocal}
              className="p-1.5 text-gray-400 hover:text-white rounded transition-colors"
              title="Download"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      <pre className="p-4 overflow-x-auto overflow-y-auto max-h-96 text-xs text-gray-300 font-mono bg-dark-950 leading-relaxed">
        {content}
      </pre>
    </div>
  );
}
