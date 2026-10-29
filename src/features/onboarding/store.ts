import { create } from 'zustand';

import type { DiscoveryAudience, FieldVisibility, Gender } from '@/types/domain';

/**
 * In-memory onboarding draft. Nothing here is persisted to disk: date of birth and gender are private,
 * and everything is submitted atomically by `complete_onboarding` on the last step.
 */
export type OnboardingDraft = {
  username: string;
  displayName: string;
  /** YYYY-MM-DD */
  dateOfBirth: string;
  gender: Gender | null;
  audience: DiscoveryAudience;
  talkToGenders: Gender[];
  heightCm: number | null;
  educationLevel: string | null;
  schoolName: string;
  workplace: string;
  jobTitle: string;
  hometown: string;
  relationshipStatus: string | null;
  drinking: string | null;
  smoking: string | null;
  visibility: {
    height: FieldVisibility;
    education: FieldVisibility;
    occupation: FieldVisibility;
    hometown: FieldVisibility;
    relationship: FieldVisibility;
    lifestyle: FieldVisibility;
  };
};

type OnboardingState = OnboardingDraft & {
  setDraft: (patch: Partial<OnboardingDraft>) => void;
  reset: () => void;
};

const initial: OnboardingDraft = {
  username: '',
  displayName: '',
  dateOfBirth: '',
  gender: null,
  audience: 'everyone',
  talkToGenders: ['woman', 'man', 'nonbinary'],
  heightCm: null,
  educationLevel: null,
  schoolName: '',
  workplace: '',
  jobTitle: '',
  hometown: '',
  relationshipStatus: null,
  drinking: null,
  smoking: null,
  visibility: {
    height: 'members', education: 'members', occupation: 'members', hometown: 'members',
    relationship: 'connections', lifestyle: 'connections',
  },
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
  ...initial,
  setDraft: (patch) => set(patch),
  reset: () => set(initial),
}));
