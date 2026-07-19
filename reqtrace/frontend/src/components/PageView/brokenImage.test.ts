// Заглушка битой картинки (v1.6.6): зарезервированное под изображение место
// не остаётся пустой дырой — заглушка занимает ровно место картинки (даже
// сама ошибка не сдвигает контент). Сам <img> живёт в DOM (без новых
// текстовых узлов — текстовые смещения якорей не сдвигаются).
import { replaceBrokenImage } from './ContentRenderer';

describe('replaceBrokenImage', () => {
  function makeImg(): HTMLImageElement {
    const img = document.createElement('img');
    img.setAttribute('src', '/api/pages/p1/attachments/scheme.png');
    img.setAttribute('alt', 'scheme.png');
    return img;
  }

  it('с известными размерами занимает ровно место картинки', () => {
    const img = makeImg();
    img.setAttribute('width', '800');
    img.setAttribute('height', '600');
    replaceBrokenImage(img);

    expect(img.src.startsWith('data:image/svg+xml')).toBe(true);
    // Зарезервированный бокс не тронут — сдвига контента нет и при ошибке.
    expect(img.getAttribute('width')).toBe('800');
    expect(img.getAttribute('height')).toBe('600');
    expect(img.style.width).toBe('');
    // Иконка с подписью не растягиваются на большой бокс.
    expect(img.style.objectFit).toBe('scale-down');
    expect(img.title).toContain('scheme.png');
    expect(img.dataset.broken).toBe('1');
  });

  it('авторская ширина с замеренной пропорцией — тоже известный бокс', () => {
    const img = makeImg();
    img.setAttribute('width', '300');
    img.style.aspectRatio = '800 / 600';
    replaceBrokenImage(img);
    expect(img.style.width).toBe('');
    expect(img.getAttribute('width')).toBe('300');
  });

  it('без известных размеров — компактный фолбэк вместо рамки нулевой высоты', () => {
    const img = makeImg();
    replaceBrokenImage(img);
    expect(img.style.width).toBe('260px');
    expect(img.style.height).toBe('72px');
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
