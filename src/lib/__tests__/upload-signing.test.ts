import { supabase } from '../supabase';
import { signedUrl, thumbnailPath } from '../upload';

jest.mock('../supabase', () => ({ supabase: { storage: { from: jest.fn() } } }));
jest.mock('@/features/media/quality', () => ({ QUALITY_PRESETS: {}, useMediaQuality: { getState: jest.fn() } }));

describe('private media URLs', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('signs nearby images in one authorized request and keeps denied paths null', async () => {
    const createSignedUrls = jest.fn(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: path.endsWith('denied.jpg') ? null : `https://example.test/${path}`,
        error: path.endsWith('denied.jpg') ? 'forbidden' : null })), error: null,
    }));
    (supabase.storage.from as jest.Mock).mockReturnValue({ createSignedUrls });
    const urls = [signedUrl('profile-photos', 'u/one.jpg'), signedUrl('profile-photos', 'u/two.jpg'),
      signedUrl('profile-photos', 'u/denied.jpg')];
    jest.advanceTimersByTime(15);
    expect(await Promise.all(urls)).toEqual(['https://example.test/u/one.jpg', 'https://example.test/u/two.jpg', null]);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(['u/one.jpg', 'u/two.jpg', 'u/denied.jpg'], 600);
  });

  it('derives only new JPEG thumbnail companions', () => {
    expect(thumbnailPath('u/image.jpg')).toBe('u/image-thumb.jpg');
    expect(thumbnailPath('u/old.png')).toBeNull();
  });
});
