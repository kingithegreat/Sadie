import React, { useEffect } from 'react';

interface ToolCall {
  tool_name: string;
  parameters: Record<string, any>;
  reasoning?: string;
  confirmation_id?: string;
}

interface ActionConfirmationProps {
  actionSummary: string;
  warnings?: string[];
  onConfirm: () => void;
  onReject: () => void;
}

const ActionConfirmation: React.FC<ActionConfirmationProps> = ({
  actionSummary,
  warnings = [],
  onConfirm,
  onReject
}) => {
  
  // Handle Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onReject();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onReject]);

  return (
    <div className="confirmation-overlay">
      <div className="confirmation-modal">
        <div className="confirmation-header">
          <h2>⚠️ Confirm Action</h2>
        </div>

        <div className="confirmation-body">
          <p className="confirmation-message">
            SADIE wants to perform an action that requires your approval.
          </p>

          <div className="action-summary">
            <strong>Action:</strong>
            <p>{actionSummary}</p>
          </div>

          {warnings && warnings.length > 0 && (
            <div className="warnings">
              <strong>Warnings:</strong>
              <ul>
                {warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="confirmation-actions">
          <button
            className="button button-cancel"
            onClick={onReject}
          >
            Cancel
          </button>
          <button
            className="button button-confirm"
            onClick={onConfirm}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export default ActionConfirmation;
