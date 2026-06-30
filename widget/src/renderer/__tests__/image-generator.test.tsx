/** @jest-environment jsdom */
/**
 * image-generator.test.tsx
 * Tests for src/renderer/components/ImageGenerator.tsx
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import ImageGenerator from '../components/ImageGenerator';

function setupElectron(impl?: () => Promise<any>) {
  (window as any).electron = {
    executeImageGenerate: jest.fn(impl ?? (() => Promise.resolve(null))),
  };
}

afterEach(() => {
  delete (window as any).electron;
});

describe('ImageGenerator — initial render', () => {
  test('renders the heading', () => {
    render(<ImageGenerator />);
    expect(screen.getByText(/Image Generation/)).toBeInTheDocument();
  });

  test('renders prompt textarea', () => {
    render(<ImageGenerator />);
    expect(screen.getByPlaceholderText(/Describe the image/i)).toBeInTheDocument();
  });

  test('renders Generate Image button (disabled by default)', () => {
    render(<ImageGenerator />);
    expect(screen.getByRole('button', { name: /Generate Image/i })).toBeDisabled();
  });

  test('enables Generate Image button when prompt is non-empty', () => {
    render(<ImageGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'a sunny beach' },
    });
    expect(screen.getByRole('button', { name: /Generate Image/i })).not.toBeDisabled();
  });

  test('renders Style select', () => {
    render(<ImageGenerator />);
    expect(screen.getByLabelText(/Style/i)).toBeInTheDocument();
  });

  test('renders Resolution select', () => {
    render(<ImageGenerator />);
    expect(screen.getByLabelText(/Resolution/i)).toBeInTheDocument();
  });

  test('renders Backend select', () => {
    render(<ImageGenerator />);
    expect(screen.getByLabelText(/Backend/i)).toBeInTheDocument();
  });
});

describe('ImageGenerator — generation success', () => {
  test('shows generated image when result is success', async () => {
    setupElectron(() =>
      Promise.resolve({ status: 'success', image: 'base64imgdata', metadata: { model: 'sd' } })
    );
    render(<ImageGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'a cat' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Image/i }));
    });
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toContain('base64imgdata');
  });

  test('shows green status banner on success', async () => {
    setupElectron(() =>
      Promise.resolve({ status: 'success', image: 'abc', metadata: {} })
    );
    render(<ImageGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'mountains' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Image/i }));
    });
    expect(screen.getByText('Generated successfully')).toBeInTheDocument();
  });

  test('shows yellow warning banner when validation.validated is false', async () => {
    setupElectron(() =>
      Promise.resolve({ status: 'success', image: 'abc', validation: { validated: false } })
    );
    render(<ImageGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'test prompt' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Image/i }));
    });
    expect(screen.getByText('Generated with warnings')).toBeInTheDocument();
  });

  test('shows metadata json below image', async () => {
    setupElectron(() =>
      Promise.resolve({ status: 'success', image: 'abc', metadata: { model: 'sd-turbo' } })
    );
    render(<ImageGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'test' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Image/i }));
    });
    expect(screen.getByText(/sd-turbo/)).toBeInTheDocument();
  });

  test('Clear button removes the generated image', async () => {
    setupElectron(() =>
      Promise.resolve({ status: 'success', image: 'abc', metadata: {} })
    );
    render(<ImageGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'x' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Image/i }));
    });
    fireEvent.click(screen.getByRole('button', { name: /Clear/i }));
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('ImageGenerator — generation failure', () => {
  test('shows error message when result is null', async () => {
    setupElectron(() => Promise.resolve(null));
    render(<ImageGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'error case' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Image/i }));
    });
    expect(screen.getByText('No response from image generator')).toBeInTheDocument();
  });

  test('shows error message from result.error.message on failure status', async () => {
    setupElectron(() =>
      Promise.resolve({ status: 'error', error: { message: 'quota exceeded' } })
    );
    render(<ImageGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'boom' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Image/i }));
    });
    expect(screen.getByText('quota exceeded')).toBeInTheDocument();
  });

  test('shows red Failed banner on failure status', async () => {
    setupElectron(() =>
      Promise.resolve({ status: 'error', error: { message: 'oops' } })
    );
    render(<ImageGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'test' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Image/i }));
    });
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  test('shows generic error text on thrown exception', async () => {
    setupElectron(() => Promise.reject(new Error('network down')));
    render(<ImageGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'boom' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Image/i }));
    });
    expect(screen.getByText('Error generating image')).toBeInTheDocument();
  });

  test('shows generic error when failure result has no error.message', async () => {
    setupElectron(() => Promise.resolve({ status: 'error' }));
    render(<ImageGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'x' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Image/i }));
    });
    expect(screen.getByText('Image generation failed')).toBeInTheDocument();
  });
});

describe('ImageGenerator — loading state', () => {
  test('shows Generating… while request in-flight', async () => {
    let resolve!: (v: any) => void;
    setupElectron(() => new Promise((res) => { resolve = res; }));
    render(<ImageGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'slow prompt' },
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Image/i }));
    });
    expect(screen.getByRole('button', { name: /Generating/i })).toBeDisabled();
    // Resolve to clean up
    await act(async () => { resolve(null); });
  });
});

describe('ImageGenerator — select controls', () => {
  test('style can be changed to artistic', () => {
    render(<ImageGenerator />);
    const select = screen.getByLabelText(/Style/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'artistic' } });
    expect(select.value).toBe('artistic');
  });

  test('resolution can be changed to 1024x1024', () => {
    render(<ImageGenerator />);
    const select = screen.getByLabelText(/Resolution/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '1024x1024' } });
    expect(select.value).toBe('1024x1024');
  });

  test('backend can be changed to local', () => {
    render(<ImageGenerator />);
    const select = screen.getByLabelText(/Backend/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'local' } });
    expect(select.value).toBe('local');
  });

  test('selected style and resolution are passed in the payload', async () => {
    const electronFn = jest.fn().mockResolvedValue({ status: 'success', image: 'x' });
    (window as any).electron = { executeImageGenerate: electronFn };
    render(<ImageGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'a dog' },
    });
    fireEvent.change(screen.getByLabelText(/Style/i), { target: { value: 'cartoon' } });
    fireEvent.change(screen.getByLabelText(/Resolution/i), { target: { value: '256x256' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Image/i }));
    });
    const payload = electronFn.mock.calls[0][0].payload;
    expect(payload.style).toBe('cartoon');
    expect(payload.resolution).toBe('256x256');
    expect(payload.prompt).toBe('a dog');
  });
});
