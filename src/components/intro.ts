import { Container, Spacer, Text } from '@mariozechner/pi-tui';
import packageJson from '../../package.json';
import { getCurrentProfile } from '../profile/current.js';
import { getModelDisplayName } from '../utils/model.js';
import { theme } from '../theme.js';

const INTRO_WIDTH = 50;

export function getStarterPrompts(hasHalalBackend: boolean): string[] {
  const currentProfile = getCurrentProfile();
  return hasHalalBackend
    ? currentProfile.vertical.starterPrompts.ready
    : currentProfile.vertical.starterPrompts.setup;
}

export class IntroComponent extends Container {
  private hasHalalBackend: boolean;
  private readonly borderTopText: Text;
  private readonly bannerText: Text;
  private readonly borderBottomText: Text;
  private readonly logoText: Text;
  private readonly titleText: Text;
  private readonly subtitleText: Text;
  private readonly modelText: Text;
  private readonly backendText: Text;
  private readonly helperText: Text;
  private readonly exampleLines: Text[] = [];

  constructor(model: string, hasHalalBackend: boolean) {
    super();
    this.hasHalalBackend = hasHalalBackend;

    this.addChild(new Spacer(1));
    this.borderTopText = new Text('', 0, 0);
    this.bannerText = new Text('', 0, 0);
    this.borderBottomText = new Text('', 0, 0);
    this.logoText = new Text('', 0, 0);
    this.titleText = new Text('', 0, 0);
    this.subtitleText = new Text('', 0, 0);
    this.modelText = new Text('', 0, 0);
    this.backendText = new Text('', 0, 0);
    this.helperText = new Text('', 0, 0);

    this.addChild(this.borderTopText);
    this.addChild(this.bannerText);
    this.addChild(this.borderBottomText);
    this.addChild(new Spacer(1));
    this.addChild(this.logoText);
    this.addChild(new Spacer(1));
    this.addChild(this.titleText);
    this.addChild(this.subtitleText);
    this.addChild(new Spacer(1));
    this.addChild(this.modelText);
    this.addChild(this.backendText);
    this.addChild(new Spacer(1));
    this.addChild(this.helperText);
    for (let i = 0; i < 6; i++) {
      const line = new Text('', 0, 0);
      this.exampleLines.push(line);
      this.addChild(line);
    }

    this.setState(model, hasHalalBackend);
  }

  setModel(model: string) {
    this.setState(model, this.hasHalalBackend);
  }

  setState(model: string, hasHalalBackend: boolean) {
    const currentProfile = getCurrentProfile();
    this.hasHalalBackend = hasHalalBackend;
    const welcomeText = currentProfile.brand.intro.welcome;
    const versionText = ` v${packageJson.version}`;
    const fullText = welcomeText + versionText;
    const padding = Math.floor((INTRO_WIDTH - fullText.length - 2) / 2);
    const trailing = INTRO_WIDTH - fullText.length - padding - 2;

    this.borderTopText.setText(theme.primary('═'.repeat(INTRO_WIDTH)));
    this.bannerText.setText(
      theme.primary(
        `║${' '.repeat(padding)}${theme.bold(welcomeText)}${theme.muted(versionText)}${' '.repeat(
          trailing,
        )}║`,
      ),
    );
    this.borderBottomText.setText(theme.primary('═'.repeat(INTRO_WIDTH)));
    this.logoText.setText(
      theme.bold(
        theme.primary(
          `\n${currentProfile.brand.intro.logoAscii}`,
        ),
      ),
    );
    this.titleText.setText(theme.muted(currentProfile.brand.intro.title));
    this.subtitleText.setText(theme.muted(currentProfile.brand.intro.subtitle));
    this.modelText.setText(
      `${theme.muted('Model: ')}${theme.primary(getModelDisplayName(model))}${theme.muted('  ·  /model to change')}`,
    );
    const backend = currentProfile.vertical.backend;
    this.backendText.setText(
      backend
        ? `${theme.muted(`${backend.statusLabel}: `)}${
            hasHalalBackend ? theme.success('ready') : theme.warning('not configured')
          }${theme.muted(
            hasHalalBackend ? `  ·  ${backend.readyDescription}` : `  ·  ${backend.missingDescription}`,
          )}`
        : theme.muted(`Focus: ${currentProfile.vertical.label}  ·  Shariah compliance, portfolio intelligence, and research`),
    );
    this.helperText.setText(
      theme.muted('Try one of these. Type /1 to /6 to insert a prompt, /guide for a Shariah workflow, or /help for commands:'),
    );

    const prompts = getStarterPrompts(hasHalalBackend);
    this.exampleLines.forEach((line, index) => {
      const prompt = prompts[index] ?? '';
      line.setText(prompt ? `${theme.primary(`${index + 1}.`)} ${prompt}` : '');
    });
  }
}
