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

  // These two were labelled "Resolution:" and "Backend:". Both are now phrased
  // for someone who does not think in pixels or know what a backend is, so the
  // queries follow the label the user actually reads. The stable ids (#resolution,
  // #backend) and the option VALUES are unchanged, so nothing downstream moves.
  test('renders the size select', () => {
    render(<ImageGenerator />);
    expect(screen.getByLabelText(/Size/i)).toBeInTheDocument();
  });

  test('renders the where-to-make-it select', () => {
    render(<ImageGenerator />);
    expect(screen.getByLabelText(/Where to make it/i)).toBeInTheDocument();
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
    expect(screen.getByText('Generated via unknown')).toBeInTheDocument();
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
    expect(screen.getByText('Generated via unknown')).toBeInTheDocument();
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
    const select = screen.getByLabelText(/Size/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '1024x1024' } });
    expect(select.value).toBe('1024x1024');
  });

  test('backend can be changed to local', () => {
    render(<ImageGenerator />);
    const select = screen.getByLabelText(/Where to make it/i) as HTMLSelectElement;
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
    fireEvent.change(screen.getByLabelText(/Size/i), { target: { value: '256x256' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Image/i }));
    });
    const payload = electronFn.mock.calls[0][0].payload;
    expect(payload.style).toBe('cartoon');
    expect(payload.resolution).toBe('256x256');
    expect(payload.prompt).toBe('a dog');
  });
});

/**
 * The wording above will keep changing; what must not come back is the
 * vocabulary. The panel is for people who do not know what a backend, a
 * resolution in pixels, or an .exe is — so assert the absence of the words
 * rather than the presence of any particular replacement.
 *
 * Deliberately checks rendered text, not source: the previous copy was
 * assembled from option labels and a status line, and a grep of this directory
 * for the old strings found nothing at all while five tests still depended on
 * them.
 */
describe('ImageGenerator — stays readable for a non-technical user', () => {
  const BANNED = [
    'backend',
    'resolution',
    'sd.exe',
    'stable-diffusion',
    'stable diffusion',
    'gguf',
    'binary',
    'model file',
    'CPU offload',
    'VRAM',
  ];

  test('no insider vocabulary in the visible panel', () => {
    const { container } = render(<ImageGenerator />);
    const shown = (container.textContent || '').toLowerCase();
    const found = BANNED.filter((w) => shown.includes(w.toLowerCase()));
    expect(found).toEqual([]);
  });

  test('the privacy-relevant choice is stated in plain words', () => {
    render(<ImageGenerator />);
    // Whether an image leaves the computer is the one thing worth being
    // unambiguous about.
    expect(screen.getByText(/Only on this PC/i)).toBeInTheDocument();
    expect(screen.getByText(/Online — free, no account/i)).toBeInTheDocument();
  });
});

describe('ImageGenerator — a durable result the user can come back to', () => {
  // Rung 1 of the image-edit ladder. The panel used to hold the finished
  // image in React state only: Clear, or closing the panel, destroyed it
  // forever. The main process now persists every generation to the same
  // folder the chat path has always used and returns where it went.
  const SAVED = { savedPath: 'C:/Users/adenk/AppData/Roaming/HomeBot/generated-images/img-1.png' };

  test('says where the durable copy lives and offers to show it', async () => {
    (window as any).electron = {
      executeImageGenerate: jest.fn().mockResolvedValue({ status: 'success', image: 'abc', ...SAVED }),
      showInFolder: jest.fn(),
    };
    render(<ImageGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'a lighthouse' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generate/i }));

    expect(await screen.findByText(/Saved with your other generated images/i)).toBeInTheDocument();
    const show = screen.getByRole('button', { name: /Show in folder/i });
    fireEvent.click(show);
    // The reveal hands over the on-disk path, not the base64.
    expect((window as any).electron.showInFolder).toHaveBeenCalledWith(SAVED.savedPath);
  });

  test('Clear destroys only the view — the note says the file survives', async () => {
    (window as any).electron = {
      executeImageGenerate: jest.fn().mockResolvedValue({ status: 'success', image: 'abc', ...SAVED }),
      showInFolder: jest.fn(),
    };
    render(<ImageGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'a lighthouse' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Generate/i }));
    await screen.findByText(/Saved with your other generated images/i);

    fireEvent.click(screen.getByRole('button', { name: 'Clear image' }));
    expect(screen.queryByText(/Show in folder/i)).toBeNull();
    // No promise that the image is gone — it is not.
  });

  test('when persistence failed, no durable promise is made', async () => {
    (window as any).electron = {
      executeImageGenerate: jest.fn().mockResolvedValue({ status: 'success', image: 'abc', savedPath: null }),
      showInFolder: jest.fn(),
    };
    render(<ImageGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'a lighthouse' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Generate/i }));
    await screen.findByAltText('Generated');
    expect(screen.queryByText(/Saved with your other generated images/i)).toBeNull();
  });
});
