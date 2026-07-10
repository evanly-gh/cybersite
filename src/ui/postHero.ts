/**
 * Task 32 — Post-hero DOM sections
 *
 * Renders semantic HTML sections into #post-hero from the RESUME data object at boot.
 * Sections: #education, #skills, #experience, #contact
 *
 * Features:
 *  - All copy comes from RESUME (no hardcoded strings in HTML)
 *  - Mono eyebrow labels (// 01 EDUCATION style)
 *  - Unbounded headings with RGB-split glitch-in on first IntersectionObserver hit
 *  - HUD card for education with corner ticks + animated border shimmer
 *  - Skills chip grid grouped by category with neon pulse + group-dim highlight
 *  - Vertical timeline for experience + achievements badge strip
 *  - "TRANSMISSION" contact panel with neon-sign flicker links
 *  - Full keyboard :focus-visible styles, min 44px tap targets, real <a href> links
 *  - No Math.random() usage
 *  - TypeScript strict
 */

import { RESUME } from '../content/resume';

/** Attach IntersectionObserver to trigger glitch-in animation once per heading.
 *
 * Belt-and-suspenders: a 1 500 ms fallback timer ensures every heading becomes
 * visible even if the IntersectionObserver never fires (JS error, browser
 * extension, element already in-viewport at load, etc.).  The glitch-in
 * animation is a progressive enhancement — visibility must never depend on it.
 */
function observeHeadings(root: HTMLElement): void {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('ph-heading--visible');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  root.querySelectorAll('.ph-heading').forEach((el) => io.observe(el));

  // Fallback: after 1 500 ms, force-show any heading not yet made visible by the
  // observer (covers observer misfire, early-in-viewport elements, etc.).
  const fallbackTimer = setTimeout(() => {
    root.querySelectorAll('.ph-heading:not(.ph-heading--visible)').forEach((el) => {
      el.classList.add('ph-heading--visible');
    });
  }, 1500);

  // If the page is unloaded before the timer fires, cancel it to avoid leaks.
  // We use a one-shot 'pagehide' listener so this doesn't accumulate.
  const cleanup = (): void => clearTimeout(fallbackTimer);
  window.addEventListener('pagehide', cleanup, { once: true });
}

/** Build the #education section. */
function buildEducation(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'education';
  section.setAttribute('aria-labelledby', 'edu-heading');

  const eyebrow = document.createElement('p');
  eyebrow.className = 'ph-eyebrow mono';
  eyebrow.textContent = '// 01 EDUCATION';

  const heading = document.createElement('h2');
  heading.id = 'edu-heading';
  heading.className = 'ph-heading display';
  heading.textContent = 'EDUCATION';

  const card = document.createElement('div');
  card.className = 'ph-edu-card';

  // Corner tick elements
  const corners = ['tl', 'tr', 'bl', 'br'];
  corners.forEach((c) => {
    const tick = document.createElement('span');
    tick.className = `ph-corner ph-corner--${c}`;
    tick.setAttribute('aria-hidden', 'true');
    card.appendChild(tick);
  });

  const school = document.createElement('p');
  school.className = 'ph-edu-school display';
  school.textContent = RESUME.education.school;

  const degrees = document.createElement('ul');
  degrees.className = 'ph-edu-degrees';
  RESUME.education.degrees.forEach((deg) => {
    const li = document.createElement('li');
    li.textContent = deg;
    degrees.appendChild(li);
  });

  const honors = document.createElement('p');
  honors.className = 'ph-edu-honors mono';
  honors.textContent = `›  ${RESUME.education.honors}`;

  const meta = document.createElement('div');
  meta.className = 'ph-edu-meta';

  const grad = document.createElement('p');
  grad.className = 'ph-edu-grad mono';
  grad.textContent = RESUME.education.graduation;

  const gpaWrap = document.createElement('div');
  gpaWrap.className = 'ph-edu-gpa-wrap';

  const gpaLabel = document.createElement('span');
  gpaLabel.className = 'ph-edu-gpa-label mono';
  gpaLabel.textContent = 'GPA';

  const gpaValue = document.createElement('span');
  gpaValue.className = 'ph-edu-gpa-value mono';
  gpaValue.textContent = RESUME.education.gpa;

  gpaWrap.appendChild(gpaLabel);
  gpaWrap.appendChild(gpaValue);

  meta.appendChild(grad);
  meta.appendChild(gpaWrap);

  const cwLabel = document.createElement('p');
  cwLabel.className = 'ph-cw-label mono';
  cwLabel.textContent = '// COURSEWORK';

  const cwList = document.createElement('ul');
  cwList.className = 'ph-cw-list mono';
  RESUME.education.coursework.forEach((course) => {
    const li = document.createElement('li');
    li.textContent = course;
    cwList.appendChild(li);
  });

  card.appendChild(school);
  card.appendChild(degrees);
  card.appendChild(honors);
  card.appendChild(meta);
  card.appendChild(cwLabel);
  card.appendChild(cwList);

  section.appendChild(eyebrow);
  section.appendChild(heading);
  section.appendChild(card);

  return section;
}

/** Build the #skills section. */
function buildSkills(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'skills';
  section.setAttribute('aria-labelledby', 'skills-heading');

  const eyebrow = document.createElement('p');
  eyebrow.className = 'ph-eyebrow mono';
  eyebrow.textContent = '// 02 SKILLS';

  const heading = document.createElement('h2');
  heading.id = 'skills-heading';
  heading.className = 'ph-heading display';
  heading.textContent = 'SKILLS';

  const grid = document.createElement('div');
  grid.className = 'ph-skills-grid';

  Object.entries(RESUME.skills).forEach(([category, chips]) => {
    const group = document.createElement('div');
    group.className = 'ph-skill-group';

    const catLabel = document.createElement('h3');
    catLabel.className = 'ph-skill-cat mono';
    catLabel.textContent = category;

    const chipList = document.createElement('ul');
    chipList.className = 'ph-chip-list';
    chipList.setAttribute('aria-label', category);

    chips.forEach((chip) => {
      const li = document.createElement('li');
      li.className = 'ph-chip';

      // Design choice: chips use <button type="button"> rather than inert <span>/<li>.
      // Rationale: the hover/focus group-dim effect (dimming other skill groups) is
      // meaningful for keyboard users — it lets them understand skill groupings while
      // navigating.  Buttons expose this interaction to AT users via focus events, which
      // trigger the same highlight/dim logic as mouse-hover.
      // Accessibility contract: no action is announced to AT because aria-label names the
      // chip content + category, and no role="button" expansion (AT reads it as "chip —
      // category, button") is misleading only if the button truly does nothing; here it
      // visually communicates skill grouping — a deliberate interaction, not dead markup.
      // If in future the group-dim effect is dropped, replace buttons with <span> + CSS
      // :hover/:focus-within on the parent group.
      const btn = document.createElement('button');
      btn.className = 'ph-chip-btn mono';
      btn.textContent = chip;
      btn.type = 'button';
      btn.setAttribute('aria-label', `${chip} — ${category}`);

      // On focus/hover: highlight siblings, dim other groups
      const highlight = (): void => {
        grid.querySelectorAll('.ph-skill-group').forEach((g) => {
          if (g !== group) {
            g.classList.add('ph-skill-group--dim');
          }
        });
        group.classList.add('ph-skill-group--active');
      };

      const unhighlight = (): void => {
        grid.querySelectorAll('.ph-skill-group').forEach((g) => {
          g.classList.remove('ph-skill-group--dim');
          g.classList.remove('ph-skill-group--active');
        });
      };

      btn.addEventListener('mouseenter', highlight);
      btn.addEventListener('mouseleave', unhighlight);
      btn.addEventListener('focus', highlight);
      btn.addEventListener('blur', unhighlight);

      li.appendChild(btn);
      chipList.appendChild(li);
    });

    group.appendChild(catLabel);
    group.appendChild(chipList);
    grid.appendChild(group);
  });

  section.appendChild(eyebrow);
  section.appendChild(heading);
  section.appendChild(grid);

  return section;
}

/** Build the #experience section including achievements. */
function buildExperience(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'experience';
  section.setAttribute('aria-labelledby', 'exp-heading');

  const eyebrow = document.createElement('p');
  eyebrow.className = 'ph-eyebrow mono';
  eyebrow.textContent = '// 03 EXPERIENCE';

  const heading = document.createElement('h2');
  heading.id = 'exp-heading';
  heading.className = 'ph-heading display';
  heading.textContent = 'EXPERIENCE';

  // Vertical timeline
  const timeline = document.createElement('ol');
  timeline.className = 'ph-timeline';
  timeline.setAttribute('aria-label', 'Work experience timeline');

  RESUME.experience.forEach((entry) => {
    const item = document.createElement('li');
    item.className = 'ph-timeline-item';

    const node = document.createElement('span');
    node.className = 'ph-timeline-node';
    node.setAttribute('aria-hidden', 'true');

    const content = document.createElement('div');
    content.className = 'ph-timeline-content';

    const role = document.createElement('h3');
    role.className = 'ph-timeline-role display';
    role.textContent = entry.role;

    const orgPeriod = document.createElement('p');
    orgPeriod.className = 'ph-timeline-org mono';
    orgPeriod.textContent = `${entry.org}  ›  ${entry.period}`;

    content.appendChild(role);
    content.appendChild(orgPeriod);

    if (entry.detail) {
      const detail = document.createElement('p');
      detail.className = 'ph-timeline-detail';
      detail.textContent = entry.detail;
      content.appendChild(detail);
    }

    item.appendChild(node);
    item.appendChild(content);
    timeline.appendChild(item);
  });

  // Achievements strip
  const achEyebrow = document.createElement('p');
  achEyebrow.className = 'ph-eyebrow mono';
  achEyebrow.textContent = '// 04 ACHIEVEMENTS';

  // h3: achievements is a subsection of #experience (one section, one h2).
  // Using h3 keeps the document outline clean — no two h2s in the same section.
  const achHeading = document.createElement('h3');
  achHeading.className = 'ph-heading ph-heading--h3 display';
  achHeading.textContent = 'ACHIEVEMENTS';
  achHeading.setAttribute('id', 'ach-heading');

  const achStrip = document.createElement('ul');
  achStrip.className = 'ph-ach-strip';
  achStrip.setAttribute('aria-label', 'Achievements');

  RESUME.achievements.forEach((ach) => {
    const li = document.createElement('li');
    li.className = 'ph-ach-card';

    const chevron = document.createElement('span');
    chevron.className = 'ph-ach-chevron mono';
    chevron.textContent = '›';
    chevron.setAttribute('aria-hidden', 'true');

    const caption = document.createElement('p');
    caption.className = 'ph-ach-caption mono';
    caption.textContent = ach;

    li.appendChild(chevron);
    li.appendChild(caption);
    achStrip.appendChild(li);
  });

  section.appendChild(eyebrow);
  section.appendChild(heading);
  section.appendChild(timeline);
  section.appendChild(achEyebrow);
  section.appendChild(achHeading);
  section.appendChild(achStrip);

  return section;
}

/** Build the #contact section (TRANSMISSION panel). */
function buildContact(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'contact';
  section.setAttribute('aria-labelledby', 'contact-heading');

  const eyebrow = document.createElement('p');
  eyebrow.className = 'ph-eyebrow mono';
  eyebrow.textContent = '// 05 CONTACT';

  const heading = document.createElement('h2');
  heading.id = 'contact-heading';
  heading.className = 'ph-heading display';
  heading.textContent = 'TRANSMISSION';

  const links = document.createElement('div');
  links.className = 'ph-contact-links';

  // Email
  const emailWrap = document.createElement('div');
  emailWrap.className = 'ph-contact-item';

  const emailLink = document.createElement('a');
  emailLink.href = `mailto:${RESUME.contact.email}`;
  emailLink.className = 'ph-contact-link display ph-flicker';
  emailLink.textContent = 'EMAIL';
  emailLink.setAttribute('aria-label', `Send email to ${RESUME.contact.email}`);

  const emailSub = document.createElement('p');
  emailSub.className = 'ph-contact-sub mono';
  emailSub.textContent = RESUME.contact.email;

  emailWrap.appendChild(emailLink);
  emailWrap.appendChild(emailSub);

  // LinkedIn
  const liWrap = document.createElement('div');
  liWrap.className = 'ph-contact-item';

  const liLink = document.createElement('a');
  liLink.href = `https://${RESUME.contact.linkedin}`;
  liLink.className = 'ph-contact-link display ph-flicker';
  liLink.textContent = 'LINKEDIN';
  liLink.target = '_blank';
  liLink.rel = 'noopener noreferrer';
  liLink.setAttribute('aria-label', 'Open LinkedIn profile (opens in new tab)');

  const liSub = document.createElement('p');
  liSub.className = 'ph-contact-sub mono';
  liSub.textContent = RESUME.contact.linkedin;

  liWrap.appendChild(liLink);
  liWrap.appendChild(liSub);

  // GitHub
  const ghWrap = document.createElement('div');
  ghWrap.className = 'ph-contact-item';

  const ghLink = document.createElement('a');
  ghLink.href = `https://${RESUME.contact.github}`;
  ghLink.className = 'ph-contact-link display ph-flicker';
  ghLink.textContent = 'GITHUB';
  ghLink.target = '_blank';
  ghLink.rel = 'noopener noreferrer';
  ghLink.setAttribute('aria-label', 'Open GitHub profile (opens in new tab)');

  const ghSub = document.createElement('p');
  ghSub.className = 'ph-contact-sub mono';
  ghSub.textContent = RESUME.contact.github;

  ghWrap.appendChild(ghLink);
  ghWrap.appendChild(ghSub);

  links.appendChild(emailWrap);
  links.appendChild(liWrap);
  links.appendChild(ghWrap);

  // Footer
  const footer = document.createElement('footer');
  footer.className = 'ph-footer mono';
  footer.textContent = '© 2026 EVAN LI — BUILT WITH THREE.JS · NIGHT CITY LOOP';

  section.appendChild(eyebrow);
  section.appendChild(heading);
  section.appendChild(links);
  section.appendChild(footer);

  return section;
}

/**
 * Build visually-hidden (.sr-only) DOM copies of all hero billboard content
 * (About paragraph, Projects, Research) so screen readers and search engines
 * get the same text the in-world billboards show.
 *
 * The block is placed FIRST inside #post-hero (before the visible sections),
 * so AT users encounter it immediately after the skip-link jump.
 *
 * Content is sourced directly from RESUME — no hardcoded copy.
 */
function buildHeroMirror(): HTMLElement {
  const div = document.createElement('div');
  div.id = 'hero-mirror';
  div.className = 'sr-only';
  div.setAttribute('aria-label', 'Hero content mirror — same information displayed in 3D scene above');

  // --- About ---
  const aboutHeading = document.createElement('h2');
  aboutHeading.textContent = `About ${RESUME.name}`;
  div.appendChild(aboutHeading);

  const aboutPara = document.createElement('p');
  aboutPara.textContent = RESUME.about.paragraph;
  div.appendChild(aboutPara);

  // --- Projects (main) ---
  const projHeading = document.createElement('h2');
  projHeading.textContent = 'Projects';
  div.appendChild(projHeading);

  [...RESUME.projectsMain, ...RESUME.projectsSmall].forEach((proj) => {
    const h3 = document.createElement('h3');
    h3.textContent = proj.title;
    div.appendChild(h3);

    const stack = document.createElement('p');
    stack.textContent = proj.stack;
    div.appendChild(stack);

    const blurb = document.createElement('p');
    blurb.textContent = proj.blurb;
    div.appendChild(blurb);
  });

  // --- Research ---
  const resHeading = document.createElement('h2');
  resHeading.textContent = 'Research';
  div.appendChild(resHeading);

  RESUME.research.forEach((item) => {
    const h3 = document.createElement('h3');
    h3.textContent = item.title;
    div.appendChild(h3);

    const stack = document.createElement('p');
    stack.textContent = item.stack;
    div.appendChild(stack);

    const blurb = document.createElement('p');
    blurb.textContent = item.blurb;
    div.appendChild(blurb);
  });

  return div;
}

/**
 * Render all post-hero sections into #post-hero.
 * Called once at boot, after the hero scene is set up.
 */
export function renderPostHero(): void {
  const container = document.getElementById('post-hero');
  if (!container) return;

  // Hero content mirror (sr-only, placed FIRST so AT users get it right after skip-link)
  container.appendChild(buildHeroMirror());

  container.appendChild(buildEducation());
  container.appendChild(buildSkills());
  container.appendChild(buildExperience());
  container.appendChild(buildContact());

  // Trigger glitch-in animation on first intersection per heading
  observeHeadings(container);
}
