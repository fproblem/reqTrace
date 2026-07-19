// Заглушка битой картинки (v1.6.6): зарезервированное под изображение место
// не остаётся пустой дырой, если картинка не загрузилась. Сам <img> живёт в
// DOM (без новых текстовых узлов — текстовые смещения якорей не сдвигаются).
import { replaceBrokenImage } from './ContentRenderer';

describe('replaceBrokenImage', () => {
  function makeImg(): HTMLImageElement {
    const img = document.createElement('img');
    img.setAttribute('src', '/api/pages/p1/attachments/scheme.png');
    img.setAttribute('alt', 'scheme.png');
    img.setAttribute('width', '800');
    img.setAttribute('height', '600');
    return img;
  }

  it('подменяет src на инлайн-заглушку и ужимает зарезервированное место', () => {
    const img = makeImg();
    replaceBrokenImage(img);

    expect(img.src.startsWith('data:image/svg+xml')).toBe(true);
    expect(img.getAttribute('width')).toBeNull();
    expect(img.getAttribute('height')).toBeNull();
    expect(img.style.width).toBe('260px');
    expect(img.title).toContain('scheme.png');
    expect(img.dataset.broken).toBe('1');
  });

  it('повторный вызов ничего не меняет (заглушка не «ломается» повторно)', () => {
    const img = makeImg();
    replaceBrokenImage(img);
    const src = img.src;
    const title = img.title;
    replaceBrokenImage(img);
    expect(img.src).toBe(src);
    expect(img.title).toBe(title);
  });

  it('без alt даёт общий текст подсказки', () => {
    const img = document.createElement('img');
    img.setAttribute('src', '/x.png');
    replaceBrokenImage(img);
    expect(img.title).toBe('Не удалось загрузить изображение');
  });
});
