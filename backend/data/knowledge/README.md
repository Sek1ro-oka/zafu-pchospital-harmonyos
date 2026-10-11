# 知识数据目录（Issue #39）

本目录存放知识问答的**文档语料**与来源清单；生成的索引与缓存不进入版本库。

```text
data/knowledge/
  knowledge.sources.json   来源清单（提交进仓库）：快照提交、每篇正文的标题/哈希，以及内部测试资料清单
  snapshot/                上游 ZAFU-PCHospital-Doc 固定提交的 Markdown 快照（提交进仓库）
    SUMMARY.md             上游目录（仅作参考，不参与索引）
    docs/**                实际正文，路径与上游 src/ 一致
  internal-test/           明确标记的内部（STAFF）合成测试资料，仅用于可见性验收，非真实案例
  index/                   生成索引与 embedding 缓存（.gitignore，机器相关）
```

- 更新快照：`pnpm knowledge:sync -- --revision <上游 40 位 sha>`，随后重新 `pnpm knowledge:index`。
- 内容、可见性与字段说明见 [backend/docs/knowledge-ai.md](../../docs/knowledge-ai.md)。
- 来源说明：`snapshot/docs` 下内容版权与署名归上游文档仓库作者所有（电脑医院文档仓库，
  仓库地址与提交记录在 `knowledge.sources.json`）；本课设只做固定提交的快照引用，不修改上游。
