/**
 * Single editable source of truth for all in-world and post-hero copy.
 * Every image is a placeholder slot (src: null) until real photography/screenshots
 * are dropped in — see src/content/placeholders.ts for the rendered texture.
 */

export interface ImageSlot {
  src: string | null;
  w: number;
  h: number;
  label: string;
}

export interface Project {
  title: string;
  stack: string;
  blurb: string;
  image: ImageSlot;
}

export interface TimelineEntry {
  role: string;
  org: string;
  period: string;
  detail?: string;
}

export interface Resume {
  name: string;
  tagline: string;
  about: {
    paragraph: string;
    faceImage: ImageSlot;
    misc: [ImageSlot, ImageSlot];
  };
  projectsMain: [Project, Project];
  projectsSmall: [Project, Project, Project];
  research: [Project, Project];
  education: {
    school: string;
    degrees: string[];
    honors: string;
    graduation: string;
    gpa: string;
    coursework: string[];
  };
  skills: Record<string, string[]>;
  experience: TimelineEntry[];
  achievements: string[];
  contact: { email: string; linkedin: string; github: string };
}

export const RESUME: Resume = {
  name: 'Evan Li',
  tagline: 'CS + Economics @ UW — ML Systems / On-Device Inference',

  about: {
    paragraph:
      'Evan Li is a Computer Science + Economics student in the Interdisciplinary ' +
      'Honors Program at the University of Washington (GPA 3.9, expected June 2027). ' +
      'His work centers on ML systems — model compression, on-device inference, and ' +
      'test-time training — building research and product systems that stay fast ' +
      'under tight memory budgets.',
    faceImage: { src: null, w: 800, h: 1000, label: 'FACE PORTRAIT' },
    misc: [
      { src: null, w: 800, h: 600, label: 'ABOUT MISC 1' },
      { src: null, w: 800, h: 600, label: 'ABOUT MISC 2' }
    ]
  },

  projectsMain: [
    {
      title: 'TTT-E2E',
      stack: 'PyTorch, HF Transformers',
      blurb:
        'Dual-branch MAML-style test-time training lifts emotion-classification ' +
        'accuracy 45% → 63% on ELSA, validated across a 4-method eval harness.',
      image: { src: null, w: 1280, h: 720, label: 'TTT-E2E' }
    },
    {
      title: 'RememberMe',
      stack: 'PyTorch, ResNet-50, FastAPI',
      blurb:
        'Team-lead project: +35% avg F1 over CLIP zero-shot across 25+ CelebA ' +
        'attributes. 6-model pipeline scores 120+ attributes with pgvector semantic ' +
        'search, cutting latency 5s → 2s under 2GB RAM.',
      image: { src: null, w: 1280, h: 720, label: 'REMEMBERME' }
    }
  ],

  projectsSmall: [
    {
      title: 'Mandarin Learning App',
      stack: 'React Native, Supabase Edge, Gemini 2.0',
      blurb:
        'Mobile Mandarin tutor: JWT-gated Deno Edge proxy to Gemini 2.0 returns ' +
        'structured JSON for inline grammar corrections.',
      image: { src: null, w: 800, h: 600, label: 'MANDARIN APP' }
    },
    {
      title: 'Bellevue College Hackathon',
      stack: 'Hackathon',
      blurb: '2nd place, 2024.',
      image: { src: null, w: 800, h: 600, label: 'BELLEVUE HACKATHON' }
    },
    {
      title: 'DubHacks 2025',
      stack: 'Hackathon',
      blurb: 'Growth Track competitor.',
      image: { src: null, w: 800, h: 600, label: 'DUBHACKS 2025' }
    }
  ],

  research: [
    {
      title: 'Mobile Intelligence Lab, UW',
      stack: 'microLLM · MAM Project',
      blurb:
        'Model compression and on-device inference research for mobile/edge under ' +
        'the MAM project, advised by Wen Cheng.',
      image: { src: null, w: 1280, h: 720, label: 'MOBILE INTELLIGENCE LAB' }
    },
    {
      title: 'LLM Hardware Benchmarking',
      stack: 'GGUF · llama.cpp',
      blurb:
        'Advised by Prof. Ranjay Krishna. Encoder/prefill/decode phase isolation with ' +
        'a cold/warm/3-median protocol; GGUF Q4_K_M quantization cuts memory ~50% at ' +
        'minimal perplexity cost.',
      image: { src: null, w: 1280, h: 720, label: 'LLM HW BENCHMARKING' }
    }
  ],

  education: {
    school: 'University of Washington',
    degrees: ['B.S. Computer Science', 'B.S. Economics'],
    honors: 'Interdisciplinary Honors Program',
    graduation: 'Expected June 2027',
    gpa: '3.9',
    coursework: ['Deep Learning', 'Data Structures & Parallelism', 'HW/SW Interface', 'Statistical Methods']
  },

  skills: {
    Languages: ['Python', 'TypeScript', 'JavaScript', 'Java', 'C/C++', 'SQL'],
    'ML Frameworks': [
      'PyTorch',
      'HuggingFace Transformers',
      'scikit-learn',
      'OpenCV',
      'MediaPipe',
      'CLIP',
      'SegFormer'
    ],
    Techniques: [
      'Fine-tuning',
      'Meta-learning (MAML/TTT)',
      'RAG',
      'Zero-shot classification',
      'GGUF quantization',
      'Evals design',
      'Vector search'
    ],
    Infrastructure: [
      'FastAPI',
      'Docker',
      'AWS',
      'Supabase',
      'pgvector',
      'llama.cpp',
      'Git',
      'HuggingFace Spaces'
    ],
    'AI Dev Tools': ['Cursor', 'Claude Code', 'GitHub Copilot']
  },

  experience: [
    {
      role: 'Undergraduate Researcher',
      org: 'Mobile Intelligence Lab, University of Washington',
      period: 'Spring 2026 – Present',
      detail:
        'microLLM research under the MAM project — model compression and ' +
        'on-device inference for mobile/edge, advised by Wen Cheng.'
    },
    {
      role: 'Associate',
      org: 'Panera Bread',
      period: 'Jun–Dec 2023 · Jun–Aug 2025',
      detail: 'Issaquah, WA'
    },
    {
      role: 'Retail Associate',
      org: 'Ross Dress For Less',
      period: 'Jun–Sep 2023',
      detail: 'Issaquah, WA'
    }
  ],

  achievements: [
    "Bellevue College Hackathon — 2nd Place (2024)",
    'DubHacks 2025 — Growth Track Competitor',
    'UW Interdisciplinary Honors Program',
    "Dean's List — Autumn 2025, Winter 2026"
  ],

  contact: {
    email: 'evanly@uw.edu',
    linkedin: 'linkedin.com/in/evanhly',
    github: 'github.com/evanly-gh'
  }
};
