import { image } from '@kit.ImageKit';
import { ApiRequestError } from '../../core/network/ApiClient';
import { CARD_RADIUS } from '../../core/ui/Theme';
import { RepairRecordService } from './RepairRecordService';

/**
 * 受保护照片缩略图（Issue #38）。
 *
 * 照片接口需要会话鉴权：这里用共享网络层带 Bearer 取字节，再解码成 PixelMap 展示。
 * 令牌不进 URL、不依赖浏览器式 `Image(url)` 直连。
 */
@Component
export struct PhotoThumb {
  @Prop photoId: string = '';
  /** 方形边长（组件名避免与内置 size 属性重名）。 */
  @Prop thumbSize: number = 96;
  /** 点击（例如打开大图预览）。 */
  onOpen: () => void = () => {
  };
  @State pixelMap: image.PixelMap | undefined = undefined;
  @State failed: boolean = false;
  private generation: number = 0;

  aboutToAppear(): void {
    this.load();
  }

  aboutToDisappear(): void {
    this.generation = this.generation + 1;
    const current = this.pixelMap;
    if (current !== undefined) {
      this.pixelMap = undefined;
      current.release().catch(() => {
      });
    }
  }

  private async load(): Promise<void> {
    this.generation = this.generation + 1;
    const generation = this.generation;
    this.failed = false;
    try {
      const bytes = await RepairRecordService.photoBytes(this.photoId);
      // 迟到的响应（组件已销毁或换了照片）不能覆盖当前内容。
      if (generation !== this.generation) {
        return;
      }
      const source = image.createImageSource(bytes);
      const decoded = await source.createPixelMap();
      source.release();
      if (generation !== this.generation) {
        decoded.release().catch(() => {
        });
        return;
      }
      this.pixelMap = decoded;
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      this.failed = true;
    }
  }

  build() {
    Stack() {
      if (this.pixelMap !== undefined) {
        Image(this.pixelMap)
          .width('100%')
          .height('100%')
          .objectFit(ImageFit.Cover)
      } else if (this.failed) {
        Column({ space: 4 }) {
          Text('图片加载失败')
            .fontSize(12)
            .fontColor($r('app.color.danger'))
          Text('点击重试')
            .fontSize(11)
            .fontColor($r('app.color.text_secondary'))
        }
        .justifyContent(FlexAlign.Center)
        .width('100%')
        .height('100%')
      } else {
        LoadingProgress()
          .width(24)
          .height(24)
          .color($r('app.color.brand'))
      }
    }
    .width(this.thumbSize)
    .height(this.thumbSize)
    .backgroundColor($r('app.color.field_bg'))
    .borderRadius(CARD_RADIUS)
    .clip(true)
    .onClick(() => {
      if (this.failed) {
        this.load();
        return;
      }
      this.onOpen();
    })
  }
}
