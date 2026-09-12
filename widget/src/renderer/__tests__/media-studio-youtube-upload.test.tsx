/** @jest-environment jsdom */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MediaStudioPanel } from '../components/MediaStudioPanel';

const baseJob = {
  id: 'yt_job_001',
  title: 'Pyramids of Ancient Egypt',
  format: 'short' as const,
  brief: 'A fast 60-second tour of the Great Pyramid and Sphinx.',
  script: 'Beneath the desert sands...',
  scenePaths: ['C:\\media\\slide1.jpg', 'C:\\media\\slide2.jpg'],
  renderPath: 'C:\\media\\output.mp4',
  createdAt: '2026-09-12T00:00:00Z',
  updatedAt: '2026-09-12T00:00:00Z',
  history: [],
};

afterEach(() => {
  delete (window as any).electron;
});

const mountPanel = async (job: any, api: Record<string, any> = {}) => {
  const mediaList = jest.fn().mockResolvedValue([job]);
  (window as any).electron = { mediaList, ...api };
  await act(async () => {
    render(<MediaStudioPanel />);
  });
};

describe('MediaStudioPanel - YouTube Upload flow', () => {
  test('approved job with rendered video displays "Upload to YouTube…" button', async () => {
    await mountPanel({ ...baseJob, state: 'approved' });

    expect(screen.getByText('▶ Upload to YouTube…')).toBeInTheDocument();
  });

  test('opening upload dialog when signed out shows Google sign-in prompt', async () => {
    const youtubeConnectionStatus = jest.fn().mockResolvedValue({
      ok: true,
      status: {
        configured: true,
        signedIn: false,
        busy: false,
        channels: [],
      },
    });
    const youtubeConnectUpload = jest.fn().mockResolvedValue({
      ok: true,
      status: { configured: true, signedIn: true, busy: false, channels: [] },
    });

    await mountPanel(
      { ...baseJob, state: 'approved' },
      { youtubeConnectionStatus, youtubeConnectUpload },
    );

    await act(async () => {
      fireEvent.click(screen.getByText('▶ Upload to YouTube…'));
    });

    expect(screen.getByText(/YouTube is not connected or sign-in is required/i)).toBeInTheDocument();
    const signInBtn = screen.getByText('Sign in with Google');
    expect(signInBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(signInBtn);
    });
    expect(youtubeConnectUpload).toHaveBeenCalled();
  });

  test('signed-in user can edit metadata and execute upload to YouTube', async () => {
    const youtubeConnectionStatus = jest.fn().mockResolvedValue({
      ok: true,
      status: {
        configured: true,
        signedIn: true,
        busy: false,
        channels: [{ id: 'ch_1', title: 'Ancient Pathways Official' }],
      },
    });
    const youtubeUpload = jest.fn().mockResolvedValue({
      ok: true,
      videoId: 'yt_new_vid_123',
      url: 'https://youtu.be/yt_new_vid_123',
      publishedAt: '2026-09-12T12:00:00Z',
    });

    await mountPanel(
      { ...baseJob, state: 'approved' },
      { youtubeConnectionStatus, youtubeUpload },
    );

    await act(async () => {
      fireEvent.click(screen.getByText('▶ Upload to YouTube…'));
    });

    // Verify channel title is displayed
    expect(screen.getByText(/Ancient Pathways Official/i)).toBeInTheDocument();

    // Verify pre-filled inputs
    const titleInput = screen.getByPlaceholderText('Title on YouTube') as HTMLInputElement;
    expect(titleInput.value).toBe('Pyramids of Ancient Egypt');

    const descInput = screen.getByPlaceholderText('Video description, links, and credits') as HTMLTextAreaElement;
    expect(descInput.value).toContain('Great Pyramid');

    // Change privacy to unlisted
    const privacySelect = screen.getByDisplayValue(/Private/i);
    await act(async () => {
      fireEvent.change(privacySelect, { target: { value: 'unlisted' } });
    });

    // Click upload
    const uploadBtn = screen.getByRole('button', { name: 'Upload to YouTube' });
    await act(async () => {
      fireEvent.click(uploadBtn);
    });

    expect(youtubeUpload).toHaveBeenCalledWith('yt_job_001', {
      title: 'Pyramids of Ancient Egypt',
      description: 'A fast 60-second tour of the Great Pyramid and Sphinx.',
      tags: ['homebot', 'video'],
      privacyStatus: 'unlisted',
      thumbnailPath: 'C:\\media\\slide1.jpg',
    });

    // Celebratory message appears
    expect(await screen.findByText(/Uploaded to YouTube/i)).toBeInTheDocument();
  });
});
