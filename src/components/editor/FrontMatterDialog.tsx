import { Button, Modal } from "@heroui/react";
import { useEffect, useState } from "react";

import { normalizeFrontMatter, parseFrontMatter, withFrontMatter } from "@/lib/front-matter";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";

/** What an empty block starts as, so the keys are discoverable. */
const TEMPLATE = "title: \ndate: \n";

/**
 * Edits the note's YAML front matter.
 *
 * The rich-text surface cannot show the block — Markdown reads its delimiters as
 * a rule and a heading — so it is edited here as source text. The body is
 * untouched, which keeps the editor's own content and undo history intact.
 */
export function FrontMatterDialog() {
  const isOpen = useUi((state) => state.isFrontMatterOpen);
  const setOpen = useUi((state) => state.setFrontMatterOpen);

  const content = useWorkspace((state) => state.content);
  const updateContent = useWorkspace((state) => state.updateContent);

  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const { raw } = parseFrontMatter(content);
    // The fences are shown, so what is written here is what lands in the file.
    setDraft(raw ? raw.trimEnd() : TEMPLATE);
  }, [isOpen]);

  const submit = () => {
    const { body } = parseFrontMatter(content);
    updateContent(withFrontMatter(normalizeFrontMatter(draft), body));
    setOpen(false);
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={setOpen}>
      <Modal.Container size="lg">
        <Modal.Dialog className="qj-dialog" aria-label="YAML 元数据">
          <div className="border-b border-border/60 px-4 py-3">
            <h2 className="text-sm font-medium">YAML 元数据</h2>
          </div>

          <div className="px-4 py-4">
            <p className="mb-2 text-xs text-muted">
              位于正文最上方的 <span className="font-mono">---</span> 区块，用于记录标题、作者、
              日期等。清空内容即可删除。
            </p>
            <textarea
              autoFocus
              aria-label="YAML 元数据内容"
              className="field qj-frontmatter-editor"
              spellCheck={false}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "s" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-border/60 px-4 py-2.5">
            <Button variant="ghost" onPress={() => setOpen(false)}>
              取消
            </Button>
            <Button onPress={submit}>保存</Button>
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
