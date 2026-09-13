import React, { useState, useEffect, useRef, useCallback } from 'react';
import './CharacterAnchorWorkbench.css';
import { useConfirmDestructive } from './ConfirmDestructive';

interface CharacterSummary {
  slug: string;
  name: string;
  totalPoses: number;
  handPlacedMouthAnchors: number;
  headBoxes: number;
  suggestedMouthAnchors: number;
  missingMouthAnchors: number;
}

interface CharacterDetail {
  slug: string;
  name: string;
  manifest: any;
  groups: string[];
  mouthVisemes: Record<string, string>;
  stats: {
    totalPoses: number;
    handPlacedMouthAnchors: number;
    headBoxes: number;
    suggestedMouthAnchors: number;
    missingMouthAnchors: number;
  };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragMode = 'none' | 'move_mouth' | 'move_head' | 'resize_mouth_br' | 'resize_head_br';

export const CharacterAnchorWorkbench: React.FC = () => {
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [selectedCharSlug, setSelectedCharSlug] = useState<string>('leila');
  const [characterDetail, setCharacterDetail] = useState<CharacterDetail | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>('pose_a');
  const [selectedPose, setSelectedPose] = useState<string>('idle');

  const [spriteDataUrl, setSpriteDataUrl] = useState<string | null>(null);
  const [spriteDims, setSpriteDims] = useState<{ w: number; h: number }>({ w: 300, h: 400 });
  const [loadingSprite, setLoadingSprite] = useState<boolean>(false);

  const [headBox, setHeadBox] = useState<Box | null>(null);
  const [mouthAnchor, setMouthAnchor] = useState<Box | null>(null);
  const [isMouthSuggested, setIsMouthSuggested] = useState<boolean>(false);

  const [zoom, setZoom] = useState<number>(2); // 200% default for comfortable pixel-precision
  const [activeViseme, setActiveViseme] = useState<string | null>(null);
  const [isLipSyncing, setIsLipSyncing] = useState<boolean>(false);

  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isSuggesting, setIsSuggesting] = useState<boolean>(false);

  // Dragging state
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const dragStartRef = useRef<{ clientX: number; clientY: number; origBox: Box }>({
    clientX: 0,
    clientY: 0,
    origBox: { x: 0, y: 0, w: 0, h: 0 },
  });

  const api = () => (window as any).electron;
  // Replacing a hand-placed anchor is an explicit, confirmed change (AP: never overwrite).
  const [confirmDialog, confirm] = useConfirmDestructive();

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3500);
  };

  // 1. Initial load: Character list & Leila
  const loadCharacters = useCallback(async (selectSlug?: string) => {
    try {
      const res = await api()?.mediaAncientPathwaysGetAnchors?.(selectSlug || selectedCharSlug);
      if (res?.ok) {
        if (res.characters) setCharacters(res.characters);
        if (res.selected) {
          setCharacterDetail(res.selected);
          // Pick initial group and pose if needed
          const groups = res.selected.groups || [];
          if (groups.length > 0 && !groups.includes(selectedGroup)) {
            setSelectedGroup(groups[0]);
            const poses = Object.keys(res.selected.manifest[groups[0]] || {});
            if (poses.length > 0) setSelectedPose(poses[0]);
          }
        }
      }
    } catch (err: any) {
      showToast(err?.message || 'Failed to load characters', 'error');
    }
  }, [selectedCharSlug, selectedGroup]);

  useEffect(() => {
    loadCharacters('leila');
  }, [loadCharacters]);

  // 2. Load character details when selected character changes
  const handleSelectCharacter = async (slug: string) => {
    setSelectedCharSlug(slug);
    try {
      const res = await api()?.mediaAncientPathwaysGetAnchors?.(slug);
      if (res?.ok && res.selected) {
        setCharacterDetail(res.selected);
        const groups = res.selected.groups || [];
        const nextGroup = groups.includes('pose_a') ? 'pose_a' : groups[0] || '';
        setSelectedGroup(nextGroup);
        const poses = Object.keys(res.selected.manifest[nextGroup] || {});
        setSelectedPose(poses[0] || '');
      }
    } catch (err: any) {
      showToast(err?.message || 'Failed to switch character', 'error');
    }
  };

  // 3. Load sprite and read current anchors whenever (character, group, pose) changes
  useEffect(() => {
    if (!characterDetail || !selectedGroup || !selectedPose) return;

    setLoadingSprite(true);
    api()?.mediaAncientPathwaysGetSprite?.(selectedCharSlug, selectedGroup, selectedPose)
      .then((res: any) => {
        if (res?.ok && res.dataUrl) {
          setSpriteDataUrl(res.dataUrl);
          const img = new Image();
          img.onload = () => {
            setSpriteDims({ w: img.naturalWidth, h: img.naturalHeight });
          };
          img.src = res.dataUrl;
        } else {
          setSpriteDataUrl(null);
        }
      })
      .catch(() => setSpriteDataUrl(null))
      .finally(() => setLoadingSprite(false));

    // Read current head box from manifest
    const manifest = characterDetail.manifest || {};
    const hBoxArr = manifest._head_boxes?.[selectedGroup]?.[selectedPose];
    if (Array.isArray(hBoxArr) && hBoxArr.length === 4) {
      setHeadBox({ x: hBoxArr[0], y: hBoxArr[1], w: hBoxArr[2], h: hBoxArr[3] });
    } else {
      setHeadBox(null);
    }

    // Read current mouth anchor (hand-placed or suggested)
    const mMouthArr = manifest._mouth_anchors?.[selectedGroup]?.[selectedPose];
    const sMouthArr = manifest._mouth_anchors_suggested?.[selectedGroup]?.[selectedPose];

    if (Array.isArray(mMouthArr) && mMouthArr.length === 4) {
      setMouthAnchor({ x: mMouthArr[0], y: mMouthArr[1], w: mMouthArr[2], h: mMouthArr[3] });
      setIsMouthSuggested(false);
    } else if (Array.isArray(sMouthArr) && sMouthArr.length === 4) {
      setMouthAnchor({ x: sMouthArr[0], y: sMouthArr[1], w: sMouthArr[2], h: sMouthArr[3] });
      setIsMouthSuggested(true);
    } else {
      setMouthAnchor(null);
      setIsMouthSuggested(false);
    }
  }, [characterDetail, selectedCharSlug, selectedGroup, selectedPose]);

  // 4. Lip sync test loop
  useEffect(() => {
    if (!isLipSyncing) return;
    const phonemes = ['A', 'E', 'I', 'O', 'U', 'M'];
    let idx = 0;
    const interval = setInterval(() => {
      setActiveViseme(phonemes[idx % phonemes.length]);
      idx++;
    }, 120);
    return () => clearInterval(interval);
  }, [isLipSyncing]);

  // 5. Drag and Resize Handlers
  const handleMouseDown = (e: React.MouseEvent, mode: DragMode, box: Box) => {
    e.stopPropagation();
    e.preventDefault();
    setDragMode(mode);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      origBox: { ...box },
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragMode === 'none') return;
      const dx = Math.round((e.clientX - dragStartRef.current.clientX) / zoom);
      const dy = Math.round((e.clientY - dragStartRef.current.clientY) / zoom);
      const orig = dragStartRef.current.origBox;

      if (dragMode === 'move_mouth' && mouthAnchor) {
        setMouthAnchor({
          ...mouthAnchor,
          x: Math.max(0, orig.x + dx),
          y: Math.max(0, orig.y + dy),
        });
      } else if (dragMode === 'move_head' && headBox) {
        setHeadBox({
          ...headBox,
          x: Math.max(0, orig.x + dx),
          y: Math.max(0, orig.y + dy),
        });
      } else if (dragMode === 'resize_mouth_br' && mouthAnchor) {
        setMouthAnchor({
          ...mouthAnchor,
          w: Math.max(4, orig.w + dx),
          h: Math.max(4, orig.h + dy),
        });
      } else if (dragMode === 'resize_head_br' && headBox) {
        setHeadBox({
          ...headBox,
          w: Math.max(10, orig.w + dx),
          h: Math.max(10, orig.h + dy),
        });
      }
    };

    const handleMouseUp = () => {
      setDragMode('none');
    };

    if (dragMode !== 'none') {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragMode, zoom, mouthAnchor, headBox]);

  // 6. Save handlers. Main refuses to replace an existing hand-placed box with a
  // different one (CONFIRM_OVERWRITE) until the owner confirms that change here.
  const saveAnchor = async (anchorType: 'mouth' | 'head', box: [number, number, number, number], confirmOverwrite = false) => {
    const label = anchorType === 'mouth' ? 'mouth anchor' : 'head box';
    setIsSaving(true);
    try {
      const res = await api()?.mediaAncientPathwaysSaveAnchor?.({
        character: selectedCharSlug,
        group: selectedGroup,
        pose: selectedPose,
        anchorType,
        box,
        ...(confirmOverwrite ? { confirmOverwrite: true } : {}),
      });
      if (res?.ok) {
        if (anchorType === 'mouth') setIsMouthSuggested(false);
        showToast(res.message || `Saved ${label} for ${selectedCharSlug} [${selectedPose}]`);
        await loadCharacters(selectedCharSlug);
      } else if (res?.code === 'CONFIRM_OVERWRITE' && Array.isArray(res.existingBox)) {
        const [ox, oy, ow, oh] = res.existingBox;
        confirm({
          title: `Replace the hand-placed ${label} for ${selectedCharSlug} ${selectedPose}?`,
          body: (
            <p>
              This pose already has a {label} placed by hand at x {ox}, y {oy}, {ow}×{oh}.
              Saving puts it at x {box[0]}, y {box[1]}, {box[2]}×{box[3]}. The current manifest is backed up first,
              and every episode that uses this pose will use the new position.
            </p>
          ),
          confirmLabel: `Replace the ${label}`,
          cancelLabel: 'Keep the hand-placed one',
          onConfirm: () => { void saveAnchor(anchorType, box, true); },
        });
      } else {
        showToast(res?.error || `Failed to save ${label}`, 'error');
      }
    } catch (err: any) {
      showToast(err?.message || 'Save error', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveMouthAnchor = async () => {
    if (!mouthAnchor) return;
    await saveAnchor('mouth', [mouthAnchor.x, mouthAnchor.y, mouthAnchor.w, mouthAnchor.h]);
  };

  const handleSaveHeadBox = async () => {
    if (!headBox) return;
    await saveAnchor('head', [headBox.x, headBox.y, headBox.w, headBox.h]);
  };

  const handleCreateDefaultMouthAnchor = () => {
    if (headBox) {
      // Create mouth anchor roughly at center bottom of head box
      const mw = Math.round(headBox.w * 0.3);
      const mh = Math.round(headBox.h * 0.18);
      const mx = Math.round(headBox.x + (headBox.w - mw) / 2);
      const my = Math.round(headBox.y + headBox.h * 0.65);
      setMouthAnchor({ x: mx, y: my, w: mw, h: mh });
    } else {
      setMouthAnchor({ x: 50, y: 70, w: 36, h: 24 });
    }
  };

  const handleCreateDefaultHeadBox = () => {
    setHeadBox({ x: 10, y: 0, w: Math.min(120, spriteDims.w - 20), h: Math.min(130, spriteDims.h / 2) });
  };

  const handleSuggestAll = async () => {
    if (!window.confirm('Run auto-suggestion for missing anchors? Existing hand-placed anchors will NOT be touched.')) {
      return;
    }
    setIsSuggesting(true);
    try {
      const res = await api()?.mediaAncientPathwaysSuggestAnchors?.(selectedCharSlug);
      if (res?.ok) {
        showToast('Suggestions applied for missing poses');
        await loadCharacters(selectedCharSlug);
      } else {
        showToast(res?.error || 'Auto-suggest failed', 'error');
      }
    } catch (err: any) {
      showToast(err?.message || 'Failed to run suggestion script', 'error');
    } finally {
      setIsSuggesting(false);
    }
  };

  // Viseme tile data URL for preview
  const activeVisemeDataUrl = activeViseme && characterDetail?.mouthVisemes?.[activeViseme];

  return (
    <div className="caw-container">
      {confirmDialog}
      {/* Top Header */}
      <div className="caw-header">
        <div className="caw-title-group">
          <h3>
            <span>🎭 Character Anchor &amp; Viseme Calibration Workbench</span>
          </h3>
          <p className="caw-subtitle">
            Calibrate head bounding boxes, mouth anchor coordinates, and verify lip sync live over character sprites.
          </p>
        </div>
        <div className="caw-actions">
          <button
            type="button"
            className="ms-btn"
            onClick={handleSuggestAll}
            disabled={isSuggesting}
            title="Derives missing anchors from Aden's hand-placed priors. Hand-placed anchors are strictly preserved."
          >
            {isSuggesting ? 'Computing...' : '✨ Auto-Suggest Missing'}
          </button>
        </div>
      </div>

      <div className="caw-main">
        {/* Left Sidebar: Character Selector & Pose Tree */}
        <div className="caw-sidebar">
          {/* Character Selector */}
          <div className="caw-sidebar-section">
            <div className="caw-section-label">
              <span>Characters ({characters.length})</span>
            </div>
            <div className="caw-char-list">
              {characters.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  className={`caw-char-btn ${c.slug === selectedCharSlug ? 'active' : ''}`}
                  onClick={() => handleSelectCharacter(c.slug)}
                  title={`Select character: ${c.name} (${c.handPlacedMouthAnchors} hand-calibrated anchors, ${c.missingMouthAnchors} unanchored)`}
                >
                  <span>{c.name}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <span className="caw-badge caw-badge-green" title="Hand-placed mouth anchors">
                      {c.handPlacedMouthAnchors}
                    </span>
                    {c.missingMouthAnchors > 0 && (
                      <span className="caw-badge caw-badge-red" title="Missing mouth anchors">
                        {c.missingMouthAnchors}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Pose Selector Tree */}
          <div className="caw-pose-tree">
            <div className="caw-section-label">
              <span>Pose Library</span>
              {characterDetail && (
                <span style={{ fontSize: '0.68rem', color: '#58a6ff' }}>
                  {characterDetail.stats.handPlacedMouthAnchors}/{characterDetail.stats.totalPoses} Anchored
                </span>
              )}
            </div>

            {characterDetail?.groups.map((grp) => {
              const posesObj = characterDetail.manifest[grp] || {};
              const poseNames = Object.keys(posesObj);
              if (poseNames.length === 0) return null;

              return (
                <div key={grp}>
                  <div className="caw-group-title">{grp.replace('_', ' ')}</div>
                  <div className="caw-pose-list">
                    {poseNames.map((pName) => {
                      const isHand = !!characterDetail.manifest._mouth_anchors?.[grp]?.[pName];
                      const isSug = !!characterDetail.manifest._mouth_anchors_suggested?.[grp]?.[pName];
                      const isCurrent = grp === selectedGroup && pName === selectedPose;

                      return (
                        <button
                          key={pName}
                          type="button"
                          className={`caw-pose-btn ${isCurrent ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedGroup(grp);
                            setSelectedPose(pName);
                          }}
                          title={`Pose: ${grp}/${pName} — ${isHand ? 'Hand-calibrated ground truth (protected)' : isSug ? 'Auto-suggested anchor' : 'Missing mouth anchor'}`}
                        >
                          <span>{pName}</span>
                          {isHand ? (
                            <span className="caw-badge caw-badge-green" title="Hand-calibrated ground truth">✓</span>
                          ) : isSug ? (
                            <span className="caw-badge caw-badge-amber" title="Auto-suggested candidate anchor">~</span>
                          ) : (
                            <span className="caw-badge caw-badge-red" title="Missing mouth anchor">✕</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center Viewport: Interactive Canvas */}
        <div className="caw-viewport-panel">
          {/* Zoom & Viewport Toolbar */}
          <div className="caw-toolbar">
            <div className="caw-toolbar-group">
              <span style={{ fontWeight: 600, color: '#f0f6fc' }}>
                {characterDetail?.name} · {selectedGroup} / {selectedPose}
              </span>
              {mouthAnchor ? (
                isMouthSuggested ? (
                  <span className="caw-badge caw-badge-amber" title="Derived candidate anchor awaiting confirmation">Auto-Suggested (Unconfirmed)</span>
                ) : (
                  <span className="caw-badge caw-badge-green" title="Ground truth anchor verified by human review">Hand-Placed ✓</span>
                )
              ) : (
                <span className="caw-badge caw-badge-red" title="No mouth anchor defined for this pose">Missing Mouth Anchor</span>
              )}
              {headBox ? (
                <span className="caw-badge caw-badge-cyan" title="Head bounding region calibrated">Head Box Defined</span>
              ) : (
                <span className="caw-badge caw-badge-amber" title="No head bounding region defined">No Head Box</span>
              )}
            </div>

            <div className="caw-toolbar-group">
              <span style={{ color: '#8b949e', fontSize: '0.75rem' }}>Zoom:</span>
              {[1, 2, 3, 4].map((z) => (
                <button
                  key={z}
                  type="button"
                  className={`ms-btn ${zoom === z ? 'ms-btn--primary' : ''}`}
                  style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                  onClick={() => setZoom(z)}
                  title={`Set viewport canvas zoom to ${z * 100}%`}
                >
                  {z * 100}%
                </button>
              ))}
            </div>
          </div>

          {/* Canvas Viewport */}
          <div className="caw-canvas-wrap">
            {loadingSprite ? (
              <div style={{ color: '#8b949e' }}>Loading sprite...</div>
            ) : spriteDataUrl ? (
              <div
                className="caw-canvas-stage"
                style={{
                  width: spriteDims.w * zoom,
                  height: spriteDims.h * zoom,
                }}
              >
                {/* Character Pose Sprite */}
                <img
                  src={spriteDataUrl}
                  alt={`${selectedCharSlug} ${selectedPose}`}
                  className="caw-sprite-img"
                  style={{
                    width: spriteDims.w * zoom,
                    height: spriteDims.h * zoom,
                  }}
                />

                {/* Head Box Overlay (Cyan) */}
                {headBox && (
                  <div
                    className="caw-box-overlay caw-box-head"
                    style={{
                      left: headBox.x * zoom,
                      top: headBox.y * zoom,
                      width: headBox.w * zoom,
                      height: headBox.h * zoom,
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'move_head', headBox)}
                    title="Head bounding box: Drag to reposition head region"
                  >
                    <span className="caw-box-label">Head Box</span>
                    <div
                      className="caw-handle caw-handle-br"
                      onMouseDown={(e) => handleMouseDown(e, 'resize_head_br', headBox)}
                      title="Drag bottom-right handle to resize head box"
                    />
                  </div>
                )}

                {/* Mouth Anchor Overlay (Gold) */}
                {mouthAnchor && (
                  <div
                    className={`caw-box-overlay caw-box-mouth ${isMouthSuggested ? 'suggested' : ''}`}
                    style={{
                      left: mouthAnchor.x * zoom,
                      top: mouthAnchor.y * zoom,
                      width: mouthAnchor.w * zoom,
                      height: mouthAnchor.h * zoom,
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'move_mouth', mouthAnchor)}
                    title="Mouth anchor: Drag to reposition mouth target over sprite lips"
                  >
                    <span className="caw-box-label">
                      {isMouthSuggested ? 'Mouth (Suggested)' : 'Mouth Anchor'}
                    </span>
                    <div className="caw-mouth-crosshair" />
                    <div
                      className="caw-handle caw-handle-br"
                      onMouseDown={(e) => handleMouseDown(e, 'resize_mouth_br', mouthAnchor)}
                      title="Drag bottom-right handle to resize mouth box"
                    />
                  </div>
                )}

                {/* Live Mouth Viseme Preview Tile */}
                {mouthAnchor && activeVisemeDataUrl && (
                  <img
                    src={activeVisemeDataUrl}
                    alt={`Viseme ${activeViseme}`}
                    className="caw-viseme-preview"
                    style={{
                      left: (mouthAnchor.x + mouthAnchor.w / 2) * zoom,
                      top: (mouthAnchor.y + mouthAnchor.h / 2) * zoom,
                      width: mouthAnchor.w * zoom,
                      height: mouthAnchor.h * zoom,
                    }}
                    title={`Live preview of viseme '${activeViseme}' positioned at calibrated coordinates`}
                  />
                )}
              </div>
            ) : (
              <div style={{ color: '#8b949e' }}>No sprite available for this pose.</div>
            )}
          </div>
        </div>

        {/* Right Drawer: Precision Coordinates & Viseme Calibration Controls */}
        <div className="caw-controls-panel">
          {/* Mouth Anchor Precision Box */}
          <div className="caw-card">
            <div className="caw-card-title">
              <span style={{ color: '#ffd700' }}>👄 Mouth Anchor [x, y, w, h]</span>
              {mouthAnchor && (
                <button
                  type="button"
                  className="ms-btn"
                  style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                  onClick={() => setMouthAnchor(null)}
                  title="Remove mouth anchor coordinates from this pose"
                >
                  Clear
                </button>
              )}
            </div>

            {mouthAnchor ? (
              <>
                <div className="caw-coords-grid">
                  <div className="caw-coord-field">
                    <span className="caw-coord-label">X:</span>
                    <input
                      type="number"
                      className="caw-coord-input"
                      value={mouthAnchor.x}
                      aria-label="Mouth anchor X"
                      onChange={(e) =>
                        setMouthAnchor({ ...mouthAnchor, x: Number(e.target.value) || 0 })
                      }
                      title="Horizontal pixel offset of mouth anchor from sprite left edge"
                    />
                  </div>
                  <div className="caw-coord-field">
                    <span className="caw-coord-label">Y:</span>
                    <input
                      type="number"
                      className="caw-coord-input"
                      value={mouthAnchor.y}
                      aria-label="Mouth anchor Y"
                      onChange={(e) =>
                        setMouthAnchor({ ...mouthAnchor, y: Number(e.target.value) || 0 })
                      }
                      title="Vertical pixel offset of mouth anchor from sprite top edge"
                    />
                  </div>
                  <div className="caw-coord-field">
                    <span className="caw-coord-label">W:</span>
                    <input
                      type="number"
                      className="caw-coord-input"
                      value={mouthAnchor.w}
                      aria-label="Mouth anchor width"
                      onChange={(e) =>
                        setMouthAnchor({ ...mouthAnchor, w: Math.max(1, Number(e.target.value) || 1) })
                      }
                      title="Pixel width of the mouth anchor bounding region"
                    />
                  </div>
                  <div className="caw-coord-field">
                    <span className="caw-coord-label">H:</span>
                    <input
                      type="number"
                      className="caw-coord-input"
                      value={mouthAnchor.h}
                      aria-label="Mouth anchor height"
                      onChange={(e) =>
                        setMouthAnchor({ ...mouthAnchor, h: Math.max(1, Number(e.target.value) || 1) })
                      }
                      title="Pixel height of the mouth anchor bounding region"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className="caw-save-btn caw-save-btn--mouth"
                  onClick={handleSaveMouthAnchor}
                  disabled={isSaving}
                  title="Persist calibrated mouth coordinates [x, y, w, h] to character manifest.json"
                >
                  {isSaving ? 'Saving...' : 'Save Mouth Anchor to Manifest'}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="ms-btn ms-btn--primary"
                style={{ width: '100%' }}
                onClick={handleCreateDefaultMouthAnchor}
                title="Create and position a default mouth anchor bounding box on this pose"
              >
                + Place Mouth Anchor
              </button>
            )}
          </div>

          {/* Head Box Precision Box */}
          <div className="caw-card">
            <div className="caw-card-title">
              <span style={{ color: '#00e5ff' }}>👤 Head Box [x, y, w, h]</span>
              {headBox && (
                <button
                  type="button"
                  className="ms-btn"
                  style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                  onClick={() => setHeadBox(null)}
                  title="Remove head bounding box coordinates from this pose"
                >
                  Clear
                </button>
              )}
            </div>

            {headBox ? (
              <>
                <div className="caw-coords-grid">
                  <div className="caw-coord-field">
                    <span className="caw-coord-label">X:</span>
                    <input
                      type="number"
                      className="caw-coord-input"
                      value={headBox.x}
                      aria-label="Head box X"
                      onChange={(e) => setHeadBox({ ...headBox, x: Number(e.target.value) || 0 })}
                      title="Horizontal pixel offset of head box from sprite left edge"
                    />
                  </div>
                  <div className="caw-coord-field">
                    <span className="caw-coord-label">Y:</span>
                    <input
                      type="number"
                      className="caw-coord-input"
                      value={headBox.y}
                      aria-label="Head box Y"
                      onChange={(e) => setHeadBox({ ...headBox, y: Number(e.target.value) || 0 })}
                      title="Vertical pixel offset of head box from sprite top edge"
                    />
                  </div>
                  <div className="caw-coord-field">
                    <span className="caw-coord-label">W:</span>
                    <input
                      type="number"
                      className="caw-coord-input"
                      value={headBox.w}
                      aria-label="Head box width"
                      onChange={(e) =>
                        setHeadBox({ ...headBox, w: Math.max(1, Number(e.target.value) || 1) })
                      }
                      title="Pixel width of the head bounding box"
                    />
                  </div>
                  <div className="caw-coord-field">
                    <span className="caw-coord-label">H:</span>
                    <input
                      type="number"
                      className="caw-coord-input"
                      value={headBox.h}
                      aria-label="Head box height"
                      onChange={(e) =>
                        setHeadBox({ ...headBox, h: Math.max(1, Number(e.target.value) || 1) })
                      }
                      title="Pixel height of the head bounding box"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className="caw-save-btn caw-save-btn--head"
                  onClick={handleSaveHeadBox}
                  disabled={isSaving}
                  title="Persist calibrated head bounding box [x, y, w, h] to character manifest.json"
                >
                  {isSaving ? 'Saving...' : 'Save Head Box to Manifest'}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="ms-btn"
                style={{ width: '100%', borderColor: '#00e5ff', color: '#00e5ff' }}
                onClick={handleCreateDefaultHeadBox}
                title="Create a default head bounding box covering the upper portion of the sprite"
              >
                + Define Head Box
              </button>
            )}
          </div>

          {/* Viseme Test & Lip Sync Simulator */}
          <div className="caw-card">
            <div className="caw-card-title">
              <span>🗣️ Viseme &amp; Lip Sync Preview</span>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '0.74rem', color: '#8b949e' }}>
              Test speech phonemes live to ensure the mouth anchor looks natural and aligned on the face.
            </p>

            <div className="caw-viseme-grid">
              <button
                type="button"
                className={`caw-viseme-btn ${activeViseme === null ? 'active' : ''}`}
                onClick={() => {
                  setIsLipSyncing(false);
                  setActiveViseme(null);
                }}
                title="Turn off viseme preview and show sprite's natural drawn mouth"
              >
                Off
              </button>
              {['A', 'E', 'I', 'O', 'U', 'M', 'B', 'L'].map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`caw-viseme-btn ${activeViseme === v ? 'active' : ''}`}
                  onClick={() => {
                    setIsLipSyncing(false);
                    setActiveViseme(v);
                  }}
                  title={`Phoneme / Viseme: ${v}`}
                >
                  {v}
                </button>
              ))}
            </div>

            <div className="caw-lipsync-bar">
              <button
                type="button"
                className={`caw-lipsync-btn ${isLipSyncing ? 'playing' : ''}`}
                onClick={() => setIsLipSyncing(!isLipSyncing)}
                title={isLipSyncing ? 'Stop speech lip sync simulation' : 'Simulate live speech: cycles visemes (A, E, I, O, U, M) at the mouth anchor'}
              >
                {isLipSyncing ? '⏸ Stop Lip Sync' : '▶ Simulate Speech'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Notification Toast */}
      {toast && <div className={`caw-toast ${toast.type}`}>{toast.text}</div>}
    </div>
  );
};
