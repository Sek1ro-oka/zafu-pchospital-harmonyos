import { image } from '@kit.ImageKit';
import { ShoppingService } from './ShoppingService';

/**
 * 商品图（公开读取）：按服务端下发的相对路径取字节并解码成 PixelMap。
 *
 * 商品图路由本身对游客开放，所以这里不传令牌；也不用浏览器式 `Image(url)`，
 * 避免把 API 基址 / 令牌拼进 URL。
 */
@Component
export struct ShoppingImage {
  @Prop @Watch('onUrlChanged') url: string = '';
  @Prop radius: number = 0;
  @State pixelMap: image.PixelMap | undefined = undefined;
  @State failed: boolean = false;
  private generation: number = 0;

  aboutToAppear(): void {
    this.load();
  }

  aboutToDisappear(): void {
    this.generation += 1;
    const current: image.PixelMap | undefined = this.pixelMap;
    if (current !== undefined) {
      this.pixelMap = undefined;
      current.release().catch(() => {
      });
    }
  }

  onUrlChanged(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.generation += 1;
    const generation: number = this.generation;
    this.failed = false;
    if (this.url === '') {
      this.pixelMap = undefined;
      return;
    }
    try {
      const bytes: ArrayBuffer = await ShoppingService.imageBytes(this.url);
      if (generation !== this.generation) return;
      const source: image.ImageSource = image.createImageSource(bytes);
      const decoded: image.PixelMap = await source.createPixelMap();
      source.release();
      if (generation !== this.generation) {
        decoded.release().catch(() => {
        });
        return;
      }
      const previous: image.PixelMap | undefined = this.pixelMap;
      this.pixelMap = decoded;
      if (previous !== undefined) {
        previous.release().catch(() => {
        });
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.failed = true;
    }
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      if (this.pixelMap !== undefined) {
        Image(this.pixelMap).width('100%').height('100%').objectFit(ImageFit.Cover)
      } else if (this.failed) {
        Column({ space: 4 }) {
          Image($r('app.media.detail_info')).width(20).height(20)
          Text('图片加载失败').fontSize(11).fontColor('#8C949A')
        }
        .onClick(() => {
          this.load();
        })
      } else if (this.url === '') {
        Column({ space: 4 }) {
          Image($r('app.media.home_nav_shopping')).width(24).height(24).objectFit(ImageFit.Contain)
          Text('暂无图片').fontSize(11).fontColor('#8C949A')
        }
      } else {
        LoadingProgress().width(22).height(22).color($r('app.color.brand'))
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.field_bg'))
    .borderRadius(this.radius)
    .clip(true)
  }
}
