/**
 * helpText — the one place plain-English hover help lives.
 *
 * GlobalTooltips looks a control up here by its visible label (or aria-label,
 * or the text of the settings label beside it) when the control has no
 * `title` / `data-tooltip` of its own. Keys are normalised with `normaliseLabel`:
 * lower-case, emoji and punctuation stripped, whitespace collapsed.
 *
 * Every entry says WHAT the control does and WHAT HAPPENS when you use it.
 * To give a control bespoke help, either add `data-tooltip="…"` to it or add
 * its label here. To silence help on a control, set `data-tooltip=""`.
 */

export function normaliseLabel(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/\(\s*\d+\s*\)/g, ' ')        // counts like "(3)"
    .replace(/[^\p{L}\p{N}&+ ]+/gu, ' ')  // emoji, arrows, punctuation
    .replace(/(^|\s)[&+]+(?=\s|$)/g, ' ') // stray "+"/"&" (e.g. "+ New Chat")
    .replace(/\s+/g, ' ')
    .trim();
}

const RAW: Record<string, string> = {
  // ── Chat / home ───────────────────────────────────────────────────────────
  'New Chat': 'Start a fresh conversation. Your current chat is saved in the sidebar.',
  'Send': 'Send your message to HomeBot. The reply appears in the conversation below.',
  'Stop': 'Stop what is running right now. Anything already produced is kept.',
  'Retry': 'Try that again with the same input. The previous failed attempt is replaced.',
  'Try again': 'Run that again. Nothing else changes.',
  'Copy': 'Copy this text to your clipboard so you can paste it elsewhere.',
  'Copy unsaved reply': 'Copy the reply that could not be saved, so you do not lose it.',
  'Clear all': 'Remove every item in this list. This cannot be undone.',
  'Clear': 'Empty this view. Saved data is not deleted.',
  'Close': 'Close this panel. Nothing is lost.',
  'Cancel': 'Back out without saving any changes.',
  'Save': 'Save your changes. They take effect straight away.',
  'Dismiss': 'Hide this message. You can carry on as normal.',
  'Reload': 'Reload this view to pick up the latest state.',
  'Refresh': 'Check again for the latest information and update this view.',
  'Open': 'Open this item.',
  'Open File': 'Pick a file from your computer to open in HomeBot.',
  'Open Settings': 'Open Settings, where you can change models, voice, privacy and more.',
  'Explore HomeBot': 'Close the welcome screen and start using HomeBot.',
  'Start Quiz': 'Switch to Quiz mode and test yourself on a topic.',
  'Home': 'Go back to the home screen.',
  'Simple': 'Show only the essential options.',
  'Advanced': 'Show every option, including expert settings.',
  'Download': 'Download this update. HomeBot keeps working while it downloads.',
  'Later': 'Remind me about this another time.',
  'Restart now': 'Restart HomeBot to finish installing the update. Unsaved work in open panels may be lost.',
  'On next launch': 'Install the update the next time you start HomeBot.',
  'Upgrade to Pro': 'See what HomeBot Pro adds and how to upgrade.',
  'Not now': 'Skip this for now. You can come back to it later.',
  'View': 'Open this result to look at it.',
  'Check again': 'Re-check the current status.',
  'Show me how instead': 'Show the manual steps so you can do it yourself.',
  'I ve done it check again': 'Re-check now that you have finished the manual step.',
  'Reload connection status': 'Re-check which services are connected.',

  // ── Permissions / consent dialogs ─────────────────────────────────────────
  'Allow once': 'Let HomeBot do this one time only. It will ask again next time.',
  'Always allow': 'Let HomeBot do this whenever it needs to, without asking. You can revoke it in Settings → Privacy.',
  'Don t allow': 'Block this action. HomeBot will not do it.',
  'Revoke': 'Remove this saved permission. HomeBot will ask again next time.',
  'I agree': 'Accept and continue. You can change this later in Settings.',
  'Decline': 'Say no. HomeBot carries on without it.',
  'Restore them': 'Bring back the items you just removed.',
  'Discard': 'Throw these changes away. This cannot be undone.',
  'Delete': 'Permanently delete this item. This cannot be undone.',
  'Remove': 'Remove this item from the list.',

  // ── First run ─────────────────────────────────────────────────────────────
  'Install Ollama automatically': 'Download and install Ollama, the free local AI engine, so chats run on your computer.',
  'Download AI': 'Download a local AI model. Chats then work offline and stay on your computer.',
  'Skip setup': 'Skip first-time setup. You can run it again from Settings → Advanced.',
  'Continue with online instead': 'Use an online AI provider instead of installing a local model.',
  'Sign in with Google': 'Connect your Google account so HomeBot can use it.',
  'Set it up for me': 'Let HomeBot configure this automatically.',
  'Run first-time setup again': 'Re-open the welcome setup to change how HomeBot is configured.',

  // ── Settings: sections and LLM / providers ────────────────────────────────
  'Models': 'Choose which AI models HomeBot uses for chat, code and vision.',
  'Voice': 'Speech recognition and voice-output settings.',
  'General': 'Theme, notifications and everyday preferences.',
  'Automations': 'Connect n8n and manage scheduled jobs.',
  'HomeBot Pro': 'Your HomeBot Pro licence on this device.',
  'Deactivate on this device': 'Remove your Pro licence from this computer so you can use it elsewhere.',
  'Chat model': 'The AI model that answers your chats. Changing it affects new replies only.',
  'Model routing': 'Let HomeBot pick a suitable model per message (for example a code model for code).',
  'Uncensored model': 'The model used when uncensored mode is on.',
  'Vision model': 'The model used to understand images you attach.',
  'Code model': 'The model used for coding questions.',
  'Coding questions only Cloud API optional': 'Optionally send only coding questions to a cloud provider. Other chats stay local.',
  'Main chat model Cloud API OpenAI Anthropic Claude subscription': 'Use a cloud AI provider for the main chat instead of a local model. Requests then leave your computer.',
  'Where your chats are answered': 'Choose whether chats are answered on your computer or by an online provider.',
  'Select Model': 'Pick which model this provider uses.',
  'Hardware Profile': 'Tells HomeBot how powerful your computer is, so it picks models that run well.',
  'Detect my GPU': 'Detect your graphics card and suggest models that fit it.',
  'Apply': 'Apply this recommendation to your settings.',
  'Default Location': 'Used for weather and local answers when you do not name a place.',
  'Chat Guidelines': 'Extra instructions HomeBot follows in every chat.',
  'Mixture of Agents MoA': 'Ask several models and combine their answers. Better quality, slower replies.',
  'Proposer Models select 2+': 'The models that each draft an answer.',
  'Aggregator Model': 'The model that merges the drafts into one final answer.',
  'LLM API Keys optional': 'Your own keys for paid AI providers. Only used if you pick that provider.',
  'Anthropic API Key': 'Your Anthropic key. Stored locally; used only when you choose Claude models.',
  'OpenAI API Key': 'Your OpenAI key. Stored locally; used only when you choose OpenAI models.',
  'Google Gemini API Key': 'Your Google Gemini key. Stored locally; used only when you choose Gemini models.',
  'Image Generation': 'Settings for creating images.',
  'Stable Horde API Key': 'Optional key for the free Stable Horde image service; gives faster queue priority.',
  'Media Studio': 'Settings for the Media Studio video tools.',
  'Privacy': 'Control what HomeBot stores and shares.',
  'Search API Keys optional': 'Optional keys for web-search services that improve search answers.',
  'Your own search server SearXNG': 'Address of your own SearXNG server for private web search.',
  'Ollama URL': 'Where HomeBot finds your local Ollama engine. Leave the default unless you moved it.',
  'Tavily API Key': 'Optional Tavily key for web search.',
  'Serper dev API Key': 'Optional Serper.dev key for Google-style web search.',
  'n8n URL': 'Address of your n8n server, used to run automations.',
  'n8n API key': 'Key HomeBot uses to talk to your n8n server.',
  'Performance metrics': 'Show how fast models respond on this computer.',
  'First-time setup': 'Re-run the guided setup.',
  'System check': 'Check that HomeBot’s components are installed and working.',
  'Theme': 'Switch between light, dark or system colours.',
  'Google Calendar': 'Connect your calendar so HomeBot can read and add events.',
  'Notifications': 'Choose which alerts HomeBot shows.',
  'Toast duration': 'How long pop-up notices stay on screen.',
  'Message Density': 'Make the chat layout more compact or more spacious.',
  'Recognition engine': 'Which speech-to-text engine turns your voice into text.',
  'Accuracy vs speed': 'Bigger speech models are more accurate but slower.',
  'Language': 'The language you speak to HomeBot in.',
  'Stop after silence seconds': 'How long a pause ends voice input.',
  'Microphone': 'Which microphone HomeBot listens to.',
  'Widget Hotkey read-only': 'The keyboard shortcut that opens HomeBot from anywhere.',
  'Permissions': 'What HomeBot is allowed to do on your computer.',
  'Permission History': 'A log of permissions you granted or denied.',
  'Telemetry consent': 'Whether anonymous usage statistics are shared. Off by default.',
  'Telemetry Consent Log': 'A record of when you changed telemetry consent.',
  'Activity & Health': 'Recent activity and the health of HomeBot’s services.',
  'Disconnect': 'Disconnect this service. HomeBot loses access until you reconnect.',
  'Add Job': 'Create a new scheduled automation job.',
  'Report a problem': 'Describe a problem; HomeBot bundles logs to help diagnose it.',
  'Use landscape defaults': 'Reset output settings to standard 16:9 landscape video.',

  // ── Media Studio: workspaces / tabs ───────────────────────────────────────
  'Storyboard': 'Plan your video shot by shot: scenes, prompts and timing.',
  'Stage': 'Arrange characters and backgrounds on a layered stage and set camera motion.',
  'Movie Router': 'Let HomeBot pick the best pipeline to turn your project into a movie.',
  'Ancient Pathways': 'Open the Ancient Pathways series workspace.',
  'Slow Pan': 'Camera slowly pans across the stage.',
  'Drift': 'Camera gently orbits and drifts for a parallax feel.',
  'Scan': 'Re-scan the music folder for background tracks.',
  'Export Selection': 'Render only the selected range of the timeline to a video file.',
  'Render Master from Cuts': 'Render the final full-length video from all your timeline cuts.',
  'Upload to YouTube': 'Upload the rendered video to your connected YouTube channel. You confirm details first.',
  'Mark as published': 'Record that this video has been published, with its link.',
  'All Episodes': 'Show episodes from every season.',
  'Open Video': 'Play the rendered video in your video player.',
  'Show in Folder': 'Open the folder that contains this file.',
  'Open file location': 'Open the folder that contains this file.',
  'Retry narration': 'Generate the voice-over again for this shot.',
  'Add video': 'Start a new video project.',
  'From a podcast': 'Create a video from a podcast episode.',
  'Make a recap': 'Turn this episode into a short recap video.',
  'From chat': 'Create a video from an idea in your chat.',
  'From Ancient Pathways': 'Create a video from the Ancient Pathways series.',
  'Export': 'Export this to a file.',

  // ── Quiz ──────────────────────────────────────────────────────────────────
  'New Quiz': 'Start a new quiz on a different topic.',
  'Retry Same Topic': 'Take another quiz on the same topic with new questions.',
  'Back to Results': 'Return to your quiz results.',
  'Submit Answer': 'Lock in your answer and see if it is right.',
  'Quit Quiz': 'Stop this quiz. Your progress is not saved.',

  // ── Workspace / code editor ───────────────────────────────────────────────
  'Overview': 'Summary of this item.',
  'Tools': 'Tools this item provides.',
  'Events': 'Recent events and logs.',
  'Conversations': 'Chats that used this item.',
  'References': 'Find everywhere this symbol is used.',
  'Type information': 'Show the type of the symbol under the cursor.',
  'Signature': 'Show the parameters of the function being called.',
  'Rename symbol F2': 'Rename this symbol everywhere it is used.',
  'Quick fixes': 'Show suggested fixes for the problem under the cursor.',
  'Format': 'Tidy the formatting of this file.',
  'Suggest code': 'Ask the assistant to suggest code at the cursor.',
  'Editor settings': 'Font size, tabs and other editor preferences.',
  'Install via npm': 'Install the language server with npm to enable smart editing.',
  'Copy command': 'Copy the install command to your clipboard.',
  'Preview rename': 'See every change the rename would make before applying it.',
  'Save Ctrl+S': 'Save this file to disk.',
  'Reject Esc': 'Reject the suggested change; the file stays as it was.',
  'Accept Ctrl+Enter': 'Accept the suggested change into the file.',
  'Interrupt Ctrl+C': 'Send Ctrl+C to stop the running command.',
  'Attach output to assistant': 'Share this terminal output with the assistant so it can help.',
  'Retry shell profiles': 'Look for available shells again.',
  'Refresh tests': 'Re-discover the tests in this project.',
  'Stop tests': 'Stop the running tests.',
  'Run test': 'Run this one test.',
  'Run file': 'Run every test in this file.',
  'Stop debugger': 'End the debugging session.',
  'Continue': 'Resume running until the next breakpoint.',
  'Pause': 'Pause the program where it is.',
  'New file': 'Create a new file.',
  'New folder': 'Create a new folder.',
  'Open project': 'Open a folder as your project.',
  'Save As': 'Save this file under a new name.',
  'Save draft as': 'Save this draft as a file.',
  'Compare': 'Compare this file with another version.',
  'Close details': 'Hide the details panel.',
  'settings json': 'Edit the raw settings file.',
  'Go': 'Go to this address.',
};

export const HELP_TEXT: ReadonlyMap<string, string> = new Map(
  Object.entries(RAW).map(([k, v]) => [normaliseLabel(k), v])
);

/** Look up help for a label; also tries the label with trailing words trimmed ("Export Selection (3s)" → "export selection"). */
export function lookupHelp(label: string | null | undefined): string | undefined {
  const key = normaliseLabel(label);
  if (!key) return undefined;
  const direct = HELP_TEXT.get(key);
  if (direct) return direct;
  const words = key.split(' ');
  for (let n = words.length - 1; n >= 2; n--) {
    const hit = HELP_TEXT.get(words.slice(0, n).join(' '));
    if (hit) return hit;
  }
  return undefined;
}
