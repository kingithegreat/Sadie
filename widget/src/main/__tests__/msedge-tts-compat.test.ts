import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

describe('the pinned Edge TTS release', () => {
  test('reconfigures a fallback voice after the primary connection is rejected', async () => {
    const tts = new MsEdgeTTS();
    const initialize = jest.spyOn(tts as any, '_initClient')
      .mockRejectedValueOnce(new Error('Unexpected server response: 403'))
      .mockResolvedValueOnce(undefined);

    await expect(tts.setMetadata('en-US-AvaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3))
      .rejects.toThrow('403');
    await expect(tts.setMetadata('en-US-JennyNeural', OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3))
      .resolves.toBeUndefined();

    expect(initialize).toHaveBeenCalledTimes(2);
    expect((tts as any)._metadataOptions.voiceLocale).toBe('en-US');
  });

  test('uses the current Edge speech endpoint', async () => {
    const url = await (MsEdgeTTS as any).getSynthUrl();
    expect(url).toMatch(/^wss:\/\/api\.msedgeservices\.com\/tts\/cognitiveservices\/websocket\/v1/);
  });
});
