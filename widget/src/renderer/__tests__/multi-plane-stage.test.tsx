/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MultiPlaneStage } from '../components/MultiPlaneStage';
import { LIGHTING_PRESETS } from '../../main/series-settings';

describe('MultiPlaneStage Renderer Component', () => {
  it('renders background and cinematic vignette', () => {
    render(<MultiPlaneStage bgSrc="file:///test/bg.png" />);

    const bgLayer = screen.getByTestId('stage-background-layer');
    expect(bgLayer).toBeInTheDocument();
    const bgImg = bgLayer.querySelector('img');
    expect(bgImg).toHaveAttribute('src', 'file:///test/bg.png');

    const vignette = screen.getByTestId('stage-vignette');
    expect(vignette).toBeInTheDocument();
  });

  it('renders contact shadow and applies room lighting CSS filter to character', () => {
    render(
      <MultiPlaneStage
        bgSrc="file:///test/bg.png"
        characterSlot={<div data-testid="test-character">Imhotep</div>}
        characterPosition={{ xPercent: 40, yPercent: 70, scale: 0.9 }}
        lighting={LIGHTING_PRESETS.torchlight}
      />
    );

    const charSlot = screen.getByTestId('test-character');
    expect(charSlot).toBeInTheDocument();

    const charLayer = screen.getByTestId('stage-character-layer');
    expect(charLayer).toHaveStyle({
      left: '40%',
      top: '70%',
      filter: 'brightness(1.08) contrast(1.1) sepia(0.22) hue-rotate(-8deg) saturate(1.15)',
    });

    const shadow = screen.getByTestId('stage-contact-shadow');
    expect(shadow).toBeInTheDocument();
    expect(shadow).toHaveStyle({
      left: '40%',
      borderRadius: '50%',
      opacity: '0.4',
    });
  });

  it('correctly stages character behind foreground desk (midground_behind_fg)', () => {
    render(
      <MultiPlaneStage
        bgSrc="file:///test/bg.png"
        fgSrc="file:///test/fg_table.png"
        characterSlot={<div>Imhotep</div>}
        depthStaging="midground_behind_fg"
      />
    );

    const fgLayer = screen.getByTestId('stage-foreground-layer');
    expect(fgLayer).toBeInTheDocument();
    expect(fgLayer).toHaveStyle({ zIndex: '30' });

    const charLayer = screen.getByTestId('stage-character-layer');
    // Behind foreground desk: zIndex 20 < 30
    expect(charLayer).toHaveStyle({ zIndex: '20' });
  });

  it('stages character in front of foreground when explicitly directed', () => {
    render(
      <MultiPlaneStage
        bgSrc="file:///test/bg.png"
        fgSrc="file:///test/fg_table.png"
        characterSlot={<div>Imhotep</div>}
        depthStaging="foreground_in_front_of_fg"
      />
    );

    const fgLayer = screen.getByTestId('stage-foreground-layer');
    expect(fgLayer).toHaveStyle({ zIndex: '30' });

    const charLayer = screen.getByTestId('stage-character-layer');
    // In front of foreground: zIndex 40 > 30
    expect(charLayer).toHaveStyle({ zIndex: '40' });
  });
});
