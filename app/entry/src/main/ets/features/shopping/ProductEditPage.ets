import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { DETAIL_BACKGROUND, DetailHeader, DetailNotice } from '../../core/ui/ReferenceDetail';
import { CARD_RADIUS, GAP_SM } from '../../core/ui/Theme';
import { PickedImage, PhotoPicker } from '../repair/PhotoPicker';
import { ShoppingImage } from './ShoppingImage';
import { ShoppingService } from './ShoppingService';
import {
  PRODUCT_CATEGORY_CONSUMABLE,
  PRODUCT_CATEGORY_SECONDHAND,
  ShoppingGoodsParam,
  ShoppingImageView,
  ShoppingProductDraft,
  ShoppingProductPatch,
  ShoppingProductView,
  shoppingCategoryLabel,
} from './ShoppingTypes';

const MAX_IMAGES: number = 9;

/**
 * 商品发布 / 编辑页（#84）。
 *
 * 新建时先保存商品，再逐张上传图片；保存成功后以 `savedId` 为准区分
 * 创建 / 编辑 / 上传恢复，图片上传失败后重试不会重复创建商品。
 * 编辑时分类不可改（后端同样忽略 category）；库存只在用户实际修改时
 * 携带 `stock + stockBase`（乐观锁基线），避免覆盖编辑期间的下单扣减。
 * 页面离开（aboutToDisappear）后所有迟到的回调静默作废，不再导航或续传。
 */
@Component
export struct ProductEditPage {
  param: ShoppingGoodsParam | null = null;
  onBack: () => void = () => {};
  onSaved: (productId: string) => void = () => {};
  onSessionExpired: () => void = () => {};

  @State productId: string = '';
  @State titleText: string = '';
  @State description: string = '';
  @State priceText: string = '';
  @State conditionText: string = '';
  @State stockText: string = '1';
  @State category: string = PRODUCT_CATEGORY_SECONDHAND;
  @State pickupNote: string = '';
  @State existingImages: ShoppingImageView[] = [];
  @State pendingImages: PickedImage[] = [];
  @State loading: boolean = false;
  @State submitting: boolean = false;
  @State uploading: boolean = false;
  @State uploadMessage: string = '';
  @State errorText: string = '';
  @State savedId: string = '';
  @State titleError: string = '';
  @State descriptionError: string = '';
  @State priceError: string = '';
  @State conditionError: string = '';
  @State stockError: string = '';
  @State categoryError: string = '';
  @State formError: string = '';
  /** 页面已离开：迟到的异步回调不得导航、失效会话或继续上传。 */
  private disposed: boolean = false;
  /** 加载（或创建）时的库存基线；-1 表示尚无基线。 */
  private loadedStock: number = -1;

  aboutToAppear(): void {
    const param: ShoppingGoodsParam | null = this.param;
    if (param !== null && param.id !== '') {
      this.productId = param.id;
      this.loadExisting(param.id);
    }
  }

  aboutToDisappear(): void {
    this.disposed = true;
  }

  private async loadExisting(id: string): Promise<void> {
    this.loading = true;
    this.errorText = '';
    try {
      const detail: ShoppingProductView = await ShoppingService.productDetail(id);
      if (this.disposed) return;
      this.titleText = detail.title;
      this.description = detail.description;
      this.priceText = this.priceInput(detail.priceCents);
      this.conditionText = detail.condition;
      this.stockText = `${detail.stock}`;
      this.loadedStock = detail.stock;
      this.category = detail.category;
      this.pickupNote = detail.pickupNote === null ? '' : detail.pickupNote;
      this.existingImages = detail.images;
    } catch (error) {
      if (this.disposed) return;
      const apiError = error as ApiRequestError;
      if (isSessionExpiredCode(apiError.code)) {
        this.onSessionExpired();
        return;
      }
      this.errorText = apiError.message;
    } finally {
      if (!this.disposed) this.loading = false;
    }
  }

  private priceInput(cents: number): string {
    const yuan: number = cents / 100;
    if (Math.abs(yuan - Math.round(yuan)) < 0.001) return `${Math.round(yuan)}`;
    return yuan.toFixed(2);
  }

  private clearErrors(): void {
    this.titleError = '';
    this.descriptionError = '';
    this.priceError = '';
    this.conditionError = '';
    this.stockError = '';
    this.categoryError = '';
    this.formError = '';
  }

  private validate(): boolean {
    this.clearErrors();
    let valid: boolean = true;
    const title: string = this.titleText.trim();
    if (title.length === 0) {
      this.titleError = '请填写商品名称';
      valid = false;
    } else if (title.length > 120) {
      this.titleError = '商品名称最多 120 字';
      valid = false;
    }
    const description: string = this.description.trim();
    if (description.length === 0) {
      this.descriptionError = '请填写商品描述';
      valid = false;
    } else if (description.length > 5000) {
      this.descriptionError = '商品描述最多 5000 字';
      valid = false;
    }
    const condition: string = this.conditionText.trim();
    if (this.category === PRODUCT_CATEGORY_SECONDHAND && condition.length === 0) {
      this.conditionError = '请填写成色，如 9成新';
      valid = false;
    } else if (condition.length > 32) {
      this.conditionError = '成色最多 32 字';
      valid = false;
    }
    if (this.category !== PRODUCT_CATEGORY_SECONDHAND && this.category !== PRODUCT_CATEGORY_CONSUMABLE) {
      this.categoryError = '请选择商品分类';
      valid = false;
    }
    const price: number = Number(this.priceText.trim());
    if (this.priceText.trim().length === 0 || !Number.isFinite(price) || price < 0) {
      this.priceError = '请填写不小于 0 的价格';
      valid = false;
    } else if (price > 100000) {
      this.priceError = '价格不能超过 100000 元';
      valid = false;
    } else if (Math.abs(price * 100 - Math.round(price * 100)) > 0.001) {
      this.priceError = '价格最多保留两位小数';
      valid = false;
    }
    const stock: number = Number(this.stockText.trim());
    const minStock: number = this.category === PRODUCT_CATEGORY_SECONDHAND && this.productId === '' ? 1 : 0;
    const maxStock: number = this.category === PRODUCT_CATEGORY_SECONDHAND ? 1 : 999;
    if (this.stockText.trim().length === 0 || !Number.isInteger(stock) || stock < minStock || stock > maxStock) {
      this.stockError = this.category === PRODUCT_CATEGORY_SECONDHAND
        ? (this.productId === '' ? '二手商品库存固定为 1' : '二手库存只能是 0 或 1')
        : '库存需为 0–999 的整数';
      valid = false;
    }
    return valid;
  }

  private draft(): ShoppingProductDraft {
    return {
      title: this.titleText.trim(),
      description: this.description.trim(),
      priceCents: Math.round(Number(this.priceText.trim()) * 100),
      category: this.category,
      condition: this.conditionText.trim(),
      stock: Number(this.stockText.trim()),
      pickupNote: this.pickupNote.trim()
    };
  }

  /**
   * 编辑 payload：库存未被用户改动时不传 `stock` / `stockBase`，
   * 改动时同时传目标值与加载时的基线，服务端做乐观锁比对，
   * 冲突返回 409（`STOCK_CONFLICT` / `STOCK_ORDER_LOCKED`），message 落到 formError。
   */
  private patchPayload(): ShoppingProductPatch {
    const patch: ShoppingProductPatch = {
      title: this.titleText.trim(),
      description: this.description.trim(),
      priceCents: Math.round(Number(this.priceText.trim()) * 100),
      condition: this.conditionText.trim(),
      pickupNote: this.pickupNote.trim() === '' ? null : this.pickupNote.trim()
    };
    const stock: number = Number(this.stockText.trim());
    if (this.loadedStock >= 0 && stock !== this.loadedStock) {
      patch.stock = stock;
      patch.stockBase = this.loadedStock;
    }
    return patch;
  }

  private async pickImages(): Promise<void> {
    if (this.uploading || this.submitting) return;
    const remain: number = MAX_IMAGES - this.existingImages.length - this.pendingImages.length;
    if (remain <= 0) {
      this.toast('最多 9 张图片');
      return;
    }
    try {
      const picked: PickedImage[] = await PhotoPicker.pick(remain);
      if (picked.length > 0) {
        this.pendingImages = this.pendingImages.concat(picked);
      }
    } catch (error) {
      this.toast('选择图片失败，请重试');
    }
  }

  private removePending(index: number): void {
    if (index < 0 || index >= this.pendingImages.length) return;
    const next: PickedImage[] = [];
    for (let i = 0; i < this.pendingImages.length; i += 1) {
      if (i !== index) next.push(this.pendingImages[i]);
    }
    this.pendingImages = next;
  }

  private async submit(): Promise<void> {
    if (this.submitting || this.uploading || this.disposed) return;
    if (!this.validate()) return;
    this.submitting = true;
    this.formError = '';
    try {
      // 以已保存的 ID 为准区分创建 / 编辑 / 上传恢复：
      // 新建成功后 savedId 已落，即便图片上传失败、用户删光待传图片再点按钮，
      // 也只会走更新 + 收尾，不会重复 createProduct。
      const existingId: string = this.productId !== '' ? this.productId : this.savedId;
      let id: string = existingId;
      if (existingId === '') {
        const created: ShoppingProductView = await ShoppingService.createProduct(this.draft());
        if (this.disposed) return;
        id = created.id;
      } else {
        await ShoppingService.updateProduct(existingId, this.patchPayload());
        if (this.disposed) return;
      }
      // 保存成功后把乐观锁基线推进到当前输入，避免后续提交携带过期 stockBase。
      this.loadedStock = Number(this.stockText.trim());
      this.savedId = id;
      if (this.pendingImages.length === 0) {
        this.onSaved(id);
        return;
      }
      await this.uploadPending(id);
    } catch (error) {
      if (this.disposed) return;
      const apiError = error as ApiRequestError;
      if (isSessionExpiredCode(apiError.code)) {
        this.onSessionExpired();
        return;
      }
      this.applyFieldErrors(apiError);
      this.formError = this.formError === '' ? apiError.message : this.formError;
    } finally {
      if (!this.disposed) this.submitting = false;
    }
  }

  private async uploadPending(id: string): Promise<void> {
    if (this.pendingImages.length === 0) {
      if (!this.disposed) this.onSaved(id);
      return;
    }
    if (this.disposed) return;
    this.uploading = true;
    this.formError = '';
    const images: PickedImage[] = this.pendingImages.slice();
    let uploaded: number = 0;
    try {
      for (let i = 0; i < images.length; i += 1) {
        if (this.disposed) return;
        this.uploadMessage = `正在上传图片 ${i + 1}/${images.length}`;
        await ShoppingService.uploadImages(id, [images[i]]);
        if (this.disposed) return;
        uploaded += 1;
        this.pendingImages = images.slice(i + 1);
      }
      this.pendingImages = [];
      this.uploadMessage = '';
      if (this.disposed) return;
      this.onSaved(id);
    } catch (error) {
      if (this.disposed) return;
      const apiError = error as ApiRequestError;
      if (isSessionExpiredCode(apiError.code)) {
        this.onSessionExpired();
        return;
      }
      this.formError = apiError.message;
      this.uploadMessage = '';
      if (uploaded > 0) {
        this.toast('部分图片已上传，可点重试继续');
      }
    } finally {
      if (!this.disposed) this.uploading = false;
    }
  }

  private async retryUpload(): Promise<void> {
    if (this.savedId === '' || this.uploading || this.disposed) return;
    this.submitting = true;
    try {
      await this.uploadPending(this.savedId);
    } finally {
      if (!this.disposed) this.submitting = false;
    }
  }

  private applyFieldErrors(error: ApiRequestError): void {
    const fields: Record<string, string[]> | undefined = error.fieldErrors;
    if (fields === undefined) return;
    this.titleError = this.fieldMessage(fields, 'title');
    this.descriptionError = this.fieldMessage(fields, 'description');
    this.priceError = this.fieldMessage(fields, 'priceCents');
    this.conditionError = this.fieldMessage(fields, 'condition');
    this.stockError = this.fieldMessage(fields, 'stock');
    this.categoryError = this.fieldMessage(fields, 'category');
  }

  private fieldMessage(fields: Record<string, string[]>, key: string): string {
    const values: string[] | undefined = fields[key];
    if (values === undefined || values.length === 0) return '';
    return values.join('；');
  }

  private toast(message: string): void {
    this.getUIContext().getPromptAction().showToast({ message: message });
  }

  /** 按钮文案：与 savedId / pendingImages 的实际行为保持一致。 */
  private submitLabel(): string {
    if (this.submitting) return '保存中…';
    if (this.savedId !== '' && this.pendingImages.length > 0) return '重试上传图片';
    if (this.productId !== '') return '保存修改';
    if (this.savedId !== '') return '完成并返回';
    return '发布商品';
  }

  @Builder
  fieldLabel(text: string) {
    Text(text).fontSize(13).fontColor('#4D5860').width('100%')
  }

  @Builder
  fieldError(text: string) {
    if (text !== '') {
      Text(text).fontSize(12).fontColor($r('app.color.danger')).width('100%')
    }
  }

  @Builder
  imageSection() {
    Column({ space: 10 }) {
      Row() {
        Text('商品图片').fontSize(13).fontColor('#4D5860').layoutWeight(1)
        Text(`${this.existingImages.length + this.pendingImages.length}/${MAX_IMAGES}`)
          .fontSize(12).fontColor('#8C949A')
      }.width('100%')
      Scroll() {
        Row({ space: GAP_SM }) {
          ForEach(this.existingImages, (image: ShoppingImageView) => {
            ShoppingImage({ url: image.url, radius: 10 })
              .width(72)
              .height(72)
          }, (image: ShoppingImageView) => image.id)
          ForEach(this.pendingImages, (image: PickedImage, index: number) => {
            Stack({ alignContent: Alignment.TopEnd }) {
              Column({ space: 2 }) {
                Text('待上传').fontSize(10).fontColor('#8A5A00')
                Text(image.fileName).fontSize(9).fontColor('#6B7780').maxLines(2)
                  .textOverflow({ overflow: TextOverflow.Ellipsis }).textAlign(TextAlign.Center)
              }.width(72).height(72).justifyContent(FlexAlign.Center).padding(4)
              .backgroundColor('#FFF8E8').borderRadius(10)
              Text('×').fontSize(14).fontColor(Color.White).width(18).height(18)
                .textAlign(TextAlign.Center).backgroundColor('#7A858D').borderRadius(9)
                .onClick(() => {
                  this.removePending(index);
                })
            }
          }, (image: PickedImage, index: number) => `${image.fileName}-${index}`)
          if (this.existingImages.length + this.pendingImages.length < MAX_IMAGES) {
            Column({ space: 4 }) {
              Text('+').fontSize(24).fontColor('#8C949A')
              Text('添加').fontSize(10).fontColor('#8C949A')
            }.width(72).height(72).justifyContent(FlexAlign.Center)
            .backgroundColor('#F2F5F7').borderRadius(10)
            .onClick(() => {
              this.pickImages();
            })
          }
        }.padding({ right: 4 })
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
      if (this.uploading && this.uploadMessage !== '') {
        Row({ space: 6 }) {
          LoadingProgress().width(16).height(16).color($r('app.color.brand'))
          Text(this.uploadMessage).fontSize(12).fontColor('#6B7780')
        }.width('100%')
      }
    }.width('100%')
  }

  build() {
    Column() {
      DetailHeader({ title: this.productId === '' ? '发布商品' : '编辑商品', onBack: this.onBack })
      if (this.loading) {
        Column({ space: 10 }) {
          LoadingProgress().width(28).height(28).color($r('app.color.brand'))
          Text('正在加载商品…').fontSize(12).fontColor('#7A858D')
        }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
      } else if (this.errorText !== '') {
        Column({ space: 12 }) {
          Text(this.errorText).fontSize(14).fontColor($r('app.color.danger')).textAlign(TextAlign.Center)
          Button('重试').height(38).fontSize(13).onClick(() => {
            if (this.productId !== '') this.loadExisting(this.productId);
          })
        }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center).padding(24)
      } else {
        Scroll() {
          Column({ space: 14 }) {
            if (this.savedId !== '' && this.formError !== '') {
              DetailNotice({ text: '商品已保存，但图片上传未完成。可重试上传后返回。' })
            }
            Column({ space: 6 }) {
              this.fieldLabel('商品名称')
              TextInput({ text: this.titleText, placeholder: '如：罗技 M720 无线鼠标' })
                .height(46).fontSize(14).backgroundColor('#F2F5F7').borderRadius(12)
                .maxLength(120).enabled(!this.submitting && !this.uploading)
                .onChange((value: string) => {
                  this.titleText = value;
                })
              this.fieldError(this.titleError)
            }.width('100%')

            Column({ space: 6 }) {
              this.fieldLabel('分类')
              Row({ space: GAP_SM }) {
                ForEach([PRODUCT_CATEGORY_SECONDHAND, PRODUCT_CATEGORY_CONSUMABLE], (item: string) => {
                  Text(shoppingCategoryLabel(item)).fontSize(13)
                    .fontColor(this.category === item ? Color.White : '#4D5860')
                    .padding({ left: 14, right: 14, top: 8, bottom: 8 })
                    .backgroundColor(this.category === item ? $r('app.color.brand') : '#EEF2F5')
                    .borderRadius(16)
                    .onClick(() => {
                      if (this.productId === '' && !this.submitting) {
                        this.category = item;
                        if (item === PRODUCT_CATEGORY_SECONDHAND) {
                          this.stockText = '1';
                        }
                      }
                    })
                }, (item: string) => item)
              }.width('100%')
              if (this.productId !== '') {
                Text('分类发布后不可修改').fontSize(10).fontColor('#8C949A').width('100%')
              }
              this.fieldError(this.categoryError)
            }.width('100%')

            Row({ space: 12 }) {
              Column({ space: 6 }) {
                this.fieldLabel('价格（元）')
                TextInput({ text: this.priceText, placeholder: '0.00' })
                  .height(46).fontSize(14).backgroundColor('#F2F5F7').borderRadius(12)
                  .enabled(!this.submitting && !this.uploading)
                  .onChange((value: string) => {
                    this.priceText = value;
                  })
                this.fieldError(this.priceError)
              }.layoutWeight(1)
              Column({ space: 6 }) {
                this.fieldLabel('库存')
                TextInput({ text: this.stockText, placeholder: '1' })
                  .height(46).fontSize(14).backgroundColor('#F2F5F7').borderRadius(12)
                  .enabled(!this.submitting && !this.uploading)
                  .onChange((value: string) => {
                    this.stockText = value;
                  })
                this.fieldError(this.stockError)
              }.width(108)
            }.width('100%').alignItems(VerticalAlign.Top)

            Column({ space: 6 }) {
              this.fieldLabel('成色')
              TextInput({ text: this.conditionText, placeholder: '如：9成新 / 未拆封' })
                .height(46).fontSize(14).backgroundColor('#F2F5F7').borderRadius(12)
                .maxLength(32).enabled(!this.submitting && !this.uploading)
                .onChange((value: string) => {
                  this.conditionText = value;
                })
              this.fieldError(this.conditionError)
            }.width('100%')

            Column({ space: 6 }) {
              this.fieldLabel('商品描述')
              TextArea({ text: this.description, placeholder: '说明使用情况、配件、交易地点等' })
                .height(130).fontSize(14).backgroundColor('#F2F5F7').borderRadius(12)
                .maxLength(5000).enabled(!this.submitting && !this.uploading)
                .onChange((value: string) => {
                  this.description = value;
                })
              this.fieldError(this.descriptionError)
            }.width('100%')

            Column({ space: 6 }) {
              this.fieldLabel('取货备注（选填）')
              TextInput({ text: this.pickupNote, placeholder: '如：工作日 18:00 后，一食堂门口' })
                .height(46).fontSize(14).backgroundColor('#F2F5F7').borderRadius(12)
                .maxLength(255).enabled(!this.submitting && !this.uploading)
                .onChange((value: string) => {
                  this.pickupNote = value;
                })
            }.width('100%')

            this.imageSection()

            if (this.formError !== '') {
              Text(this.formError).fontSize(12).fontColor($r('app.color.danger')).width('100%').lineHeight(18)
            }

            Button(this.submitLabel())
              .width('100%').height(48).fontSize(15).fontColor(Color.White)
              .backgroundColor($r('app.color.brand'))
              .enabled(!this.submitting && !this.uploading)
              .onClick(() => {
                if (this.savedId !== '' && this.pendingImages.length > 0) {
                  this.retryUpload();
                } else {
                  this.submit();
                }
              })

            Text('线下交易，请勿在商品描述中填写银行卡、密码等敏感信息。')
              .fontSize(10).fontColor('#8C949A').width('100%').textAlign(TextAlign.Center)
              .padding({ bottom: 24 })
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 8 })
          .alignItems(HorizontalAlign.Start)
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
        .align(Alignment.Top)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(DETAIL_BACKGROUND)
  }
}
