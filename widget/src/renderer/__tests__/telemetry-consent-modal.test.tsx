/** @jest-environment jsdom */
/**
 * telemetry-consent-modal.test.tsx
 * Tests for src/renderer/components/TelemetryConsentModal.tsx
 */

import { render, screen, fireEvent } from '@testing-library/react';
import TelemetryConsentModal from '../components/TelemetryConsentModal';

const noop = () => {};

describe('TelemetryConsentModal', () => {
  test('renders nothing when open=false', () => {
    const { container } = render(
      <TelemetryConsentModal open={false} onAccept={noop} onDecline={noop} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders modal content when open=true', () => {
    render(
      <TelemetryConsentModal open={true} onAccept={noop} onDecline={noop} />
    );
    expect(screen.getByText('Telemetry Consent')).toBeInTheDocument();
  });

  test('renders I agree and Decline buttons', () => {
    render(
      <TelemetryConsentModal open={true} onAccept={noop} onDecline={noop} />
    );
    expect(screen.getByText('I agree')).toBeInTheDocument();
    expect(screen.getByText('Decline')).toBeInTheDocument();
  });

  test('calls onAccept when I agree is clicked', () => {
    const onAccept = jest.fn();
    render(
      <TelemetryConsentModal open={true} onAccept={onAccept} onDecline={noop} />
    );
    fireEvent.click(screen.getByText('I agree'));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  test('calls onDecline when Decline is clicked', () => {
    const onDecline = jest.fn();
    render(
      <TelemetryConsentModal open={true} onAccept={noop} onDecline={onDecline} />
    );
    fireEvent.click(screen.getByText('Decline'));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  test('calls onClose when I agree is clicked (if provided)', () => {
    const onClose = jest.fn();
    render(
      <TelemetryConsentModal open={true} onAccept={noop} onDecline={noop} onClose={onClose} />
    );
    fireEvent.click(screen.getByText('I agree'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('calls onClose when Decline is clicked (if provided)', () => {
    const onClose = jest.fn();
    render(
      <TelemetryConsentModal open={true} onAccept={noop} onDecline={noop} onClose={onClose} />
    );
    fireEvent.click(screen.getByText('Decline'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('does not throw when onClose is not provided on accept', () => {
    render(
      <TelemetryConsentModal open={true} onAccept={noop} onDecline={noop} />
    );
    expect(() => fireEvent.click(screen.getByText('I agree'))).not.toThrow();
  });

  test('does not throw when onClose is not provided on decline', () => {
    render(
      <TelemetryConsentModal open={true} onAccept={noop} onDecline={noop} />
    );
    expect(() => fireEvent.click(screen.getByText('Decline'))).not.toThrow();
  });

  test('renders consent version text', () => {
    render(
      <TelemetryConsentModal open={true} onAccept={noop} onDecline={noop} />
    );
    expect(document.body.textContent).toContain('Consent version: 1.0');
  });

  test('renders anonymous data disclosure text', () => {
    render(
      <TelemetryConsentModal open={true} onAccept={noop} onDecline={noop} />
    );
    expect(document.body.textContent).toContain('anonymous');
  });

  test('has accessible data-role attribute for selectors', () => {
    const { container } = render(
      <TelemetryConsentModal open={true} onAccept={noop} onDecline={noop} />
    );
    expect(container.querySelector('[data-role="telemetry-consent"]')).not.toBeNull();
  });
});
