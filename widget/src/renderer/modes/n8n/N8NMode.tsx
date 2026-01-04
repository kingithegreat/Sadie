import React from 'react';
import { Workflow } from 'lucide-react';

export function N8NMode() {
  return (
    <div className="n8n-mode">
      <div className="n8n-hero">
        <Workflow size={64} className="n8n-icon" />
        <h1>N8N Automation Builder</h1>
        <p>Describe your automation in plain English, and I'll build the N8N workflow for you.</p>
      </div>

      <div className="n8n-placeholder">
        <div className="coming-soon">
          <h2>🚧 Coming Soon</h2>
          <p>We're building something awesome here!</p>
          <ul>
            <li>✅ Natural language workflow generation</li>
            <li>✅ Deploy directly to your N8N instance</li>
            <li>✅ Template library for common automations</li>
            <li>✅ Workflow validation and testing</li>
          </ul>
        </div>
      </div>
    </div>
  );
}