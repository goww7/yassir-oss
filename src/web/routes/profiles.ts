import { Hono } from 'hono';
import { getCurrentProfile, hasCurrentProfileBackendConfigured } from '../../profile/current.js';
import packageJson from '../../../package.json';

const profiles = new Hono();

profiles.get('/profiles', (c) => {
  const p = getCurrentProfile();
  const current = {
    id: p.id,
    name: p.brand.name,
    vertical: p.vertical.label,
    description: p.vertical.description,
    logo: p.brand.intro.logoAscii,
    title: p.brand.intro.title,
    subtitle: p.brand.intro.subtitle,
    palette: p.brand.palette,
    starterPrompts: {
      ready: p.vertical.starterPrompts.ready,
      setup: p.vertical.starterPrompts.setup,
    },
    backend: p.vertical.backend ? {
      label: p.vertical.backend.label,
      statusLabel: p.vertical.backend.statusLabel,
      readyDescription: p.vertical.backend.readyDescription,
      missingDescription: p.vertical.backend.missingDescription,
    } : null,
  };
  const hasBackend = hasCurrentProfileBackendConfigured();
  return c.json({
    profiles: [current],
    hasBackend,
    version: packageJson.version,
    model: process.env.DEFAULT_MODEL || 'gpt-5.4',
  });
});

export { profiles };
