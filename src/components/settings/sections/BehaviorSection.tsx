import { Button } from "@heroui/react";
import { useState } from "react";

import { RangeField, SettingGroup, SettingRow, Toggle } from "@/components/settings/controls";
import { useSetting } from "@/components/settings/use-setting";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useSettings } from "@/stores/settings";

export function BehaviorSection() {
  const [autoSave, setAutoSave] = useSetting("autoSave");
  const [autoSaveDelay, setAutoSaveDelay] = useSetting("autoSaveDelay");
  const [confirmBeforeDelete, setConfirmBeforeDelete] = useSetting("confirmBeforeDelete");
  const [restoreLastWorkspace, setRestoreLastWorkspace] = useSetting("restoreLastWorkspace");
  const [showSidebar, setShowSidebar] = useSetting("showSidebar");
  const [showOutline, setShowOutline] = useSetting("showOutline");
  const [sidebarWidth, setSidebarWidth] = useSetting("sidebarWidth");
  const [infoWidth, setInfoWidth] = useSetting("infoWidth");

  const [isResetOpen, setIsResetOpen] = useState(false);

  return (
    <>
      <SettingGroup title="保存">
        <SettingRow label="自动保存" hint="关闭后需要手动按 Ctrl+S 才会写入磁盘">
          <Toggle ariaLabel="自动保存" checked={autoSave} onChange={setAutoSave} />
        </SettingRow>
        <SettingRow label="保存延迟" hint={autoSave ? undefined : "自动保存已关闭"}>
          <RangeField
            ariaLabel="保存延迟"
            value={autoSaveDelay}
            min={200}
            max={3000}
            step={100}
            onChange={setAutoSaveDelay}
            unit="ms"
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="启动与删除">
        <SettingRow label="启动时恢复上次工作区" hint="关闭后启动停留在空状态">
          <Toggle
            ariaLabel="启动时恢复上次工作区"
            checked={restoreLastWorkspace}
            onChange={setRestoreLastWorkspace}
          />
        </SettingRow>
        <SettingRow label="删除前确认" hint="关闭后删除笔记不再弹出确认框">
          <Toggle
            ariaLabel="删除前确认"
            checked={confirmBeforeDelete}
            onChange={setConfirmBeforeDelete}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="布局">
        <SettingRow label="默认显示侧边栏">
          <Toggle ariaLabel="默认显示侧边栏" checked={showSidebar} onChange={setShowSidebar} />
        </SettingRow>
        <SettingRow label="默认显示大纲">
          <Toggle ariaLabel="默认显示大纲" checked={showOutline} onChange={setShowOutline} />
        </SettingRow>
        <SettingRow label="侧边栏宽度" hint="可以直接拖分栏边框；双击边框恢复默认">
          <RangeField
            ariaLabel="侧边栏宽度"
            value={sidebarWidth}
            min={200}
            max={520}
            step={4}
            onChange={setSidebarWidth}
            unit="px"
          />
        </SettingRow>
        <SettingRow label="大纲宽度" hint="右侧大纲 / 信息栏；同样可以拖边框，双击恢复默认">
          <RangeField
            ariaLabel="大纲宽度"
            value={infoWidth}
            min={180}
            max={560}
            step={4}
            onChange={setInfoWidth}
            unit="px"
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="重置">
        <SettingRow
          label="恢复全部默认设置"
          hint="外观、编辑器、代码、Markdown、图像（含图床仓库与分支）、导出与行为的每一项都回到初始值；只影响设置，笔记内容与已保存的访问令牌不受影响"
        >
          <Button variant="outline" onPress={() => setIsResetOpen(true)}>
            恢复默认
          </Button>
        </SettingRow>
      </SettingGroup>

      <ConfirmDialog
        isOpen={isResetOpen}
        onOpenChange={setIsResetOpen}
        title="恢复全部默认设置？"
        description="外观、编辑器、代码、Markdown、图像（含图床仓库、分支与目录）、导出与行为的每一项都会被重置。笔记内容不受影响；访问令牌存在另一处，不会被清除。只想重置某一页时，用那一页右上角的「恢复本页默认」。"
        confirmLabel="全部恢复默认"
        onConfirm={() => useSettings.getState().reset()}
      />
    </>
  );
}
