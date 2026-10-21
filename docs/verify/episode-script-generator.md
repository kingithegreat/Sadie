# Verify: Generate episode script (Media Studio)

For Aden. About 5 minutes. This uses your own DeepSeek key; one Generate is one small chat request (well under a cent).

## 1. Set the provider

1. Open **Settings → Models → Cloud provider**.
2. Provider: **DeepSeek**. Base URL: `https://api.deepseek.com/v1` (filled in for you).
3. Model: `deepseek-flash` (or `deepseek-v4-pro` for the stronger tier). These are the current IDs on [DeepSeek's Models & Pricing page](https://api-docs.deepseek.com/quick_start/pricing). If you had `deepseek-chat`, `deepseek-reasoner` or `deepseek-v4-flash` saved, it should already show as `deepseek-flash`.
4. Paste your API key, click **Test connection**, and make sure **Online** is on.

## 2. Generate

1. Open **Media Studio → Storyboard**.
2. Click **📝 Episode Script**.
3. Paste this premise:

   > A lighthouse keeper on a stormy island finds a message in a bottle from her younger self, warning her not to light the lamp tonight.

4. Leave the shot count at **4** and click **Generate**.

**Expected:** within about 30 seconds you see a title, a genre (probably *Neo-Noir Thriller* or *Mythic Fantasy*), a numbered list of 4 shots with a narration line each, and the full JSON in a read-only box. The JSON has `schemaVersion`, `title`, `logline`, `genre`, `totalDurationSec` and `shots[]`. Each shot has `shotId` (`shot_001` to `shot_004`), `framing`, `lens`, `movement`, `durationSec`, `narration` and `prompt`.

5. Click **Copy JSON** and paste it somewhere: it should match the box. **Export JSON** should download `<title>.json`.

## 3. Load it as a storyboard

1. Click **Load as storyboard**.

**Expected:** the generator closes, and you see *Loaded episode script "…" as a storyboard with 4 shots.* The new project is selected in the storyboard list, and the deck shows 4 shot cards in order. Each card has the camera framing, lens and movement from the JSON and its narration line. Nothing is rendered and no frames are made until you choose a frame provider and click Generate Frames as usual.

## Error checks (optional)

- Clear the model ID in Settings, then click Generate. You should see "No cloud model is set up…", and no request is sent.
- Put a wrong key in. You should see "The provider returned HTTP 401 … Check the API key in Settings."
- Turn Online off. You should see "… needs Online access."
