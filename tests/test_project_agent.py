import ctypes
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('project_agent_test', Path(__file__).parents[1] / 'project_agent.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProjectFilesTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.files = module.ProjectFiles(self.root)

    def tearDown(self):
        self.directory.cleanup()

    def write(self, name, text):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(text.encode('utf-8'))
        return target

    def change(self, path='settings.json', old='1', new='2'):
        return {'path': path, 'old_text': old, 'new_text': new}

    def test_prepare_has_diff_without_writing_or_backups(self):
        target = self.write('settings.json', '{"steps": 1}\n')
        plan = self.files.prepare([self.change()], '调整步数')
        self.assertIn('-{"steps": 1}', plan['instruction'])
        self.assertIn('+{"steps": 2}', plan['instruction'])
        self.assertEqual(target.read_text(), '{"steps": 1}\n')
        self.assertFalse((self.root / module.PRIVATE_DIR).exists())

    def test_diff_shows_change_to_last_newline(self):
        self.write('config.txt', 'value')
        plan = self.files.prepare([self.change('config.txt', 'value', 'value\n')], '补齐换行')
        self.assertIn('-value\n\\ No newline at end of file\n+value', plan['instruction'])

    def test_confirm_preserves_bom_crlf_and_undo_restores_bytes(self):
        target = self.write('settings.json', '\ufeff{\r\n  "steps": 1\r\n}\r\n')
        before = target.read_bytes()
        plan = self.files.prepare([self.change(old='  "steps": 1\n', new='  "steps": 2\n')], '调整')
        result = self.files.apply(plan)
        self.assertTrue(result['ok'])
        self.assertEqual(target.read_bytes(), before.replace(b'1', b'2'))
        self.assertEqual(result['syntax_checked'], ['settings.json'])
        record = json.loads(self.files.record_path(result['record_id']).read_text(encoding='utf-8'))
        self.assertEqual(record['files'][0]['before'].encode('utf-8'), before)
        undo = self.files.undo(result['record_id'])
        self.assertEqual(target.read_bytes(), before.replace(b'1', b'2'))
        self.files.apply(undo)
        self.assertEqual(target.read_bytes(), before)

    def test_new_file_undo_removes_only_the_new_file(self):
        self.write('existing.txt', 'keep')
        result = self.files.apply(self.files.prepare([self.change('new.py', '', 'value = 1\n')], '增加配置'))
        self.assertTrue((self.root / 'new.py').exists())
        plan = self.files.undo(result['record_id'])
        self.assertIn('/dev/null', plan['instruction'])
        self.files.apply(plan)
        self.assertFalse((self.root / 'new.py').exists())
        self.assertEqual((self.root / 'existing.txt').read_text(), 'keep')

    def test_edit_conflict_prevents_all_writes(self):
        first = self.write('first.py', 'value = 1\n')
        second = self.write('second.py', 'value = 1\n')
        plan = self.files.prepare([self.change('first.py'), self.change('second.py')], '调整')
        second.write_text('value = 3\n')
        with self.assertRaisesRegex(ValueError, '已改变'):
            self.files.apply(plan)
        self.assertEqual(first.read_text(), 'value = 1\n')
        self.assertEqual(second.read_text(), 'value = 3\n')
        self.assertFalse((self.root / module.PRIVATE_DIR).exists())

    def test_new_file_conflict_and_undo_conflict(self):
        plan = self.files.prepare([self.change('new.py', '', 'value = 1\n')], '创建')
        self.write('new.py', 'value = 7\n')
        with self.assertRaises(ValueError):
            self.files.apply(plan)
        result = self.files.apply(self.files.prepare([self.change('new.py', '7', '8')], '调整'))
        self.write('new.py', 'value = 9\n')
        with self.assertRaisesRegex(ValueError, '其他修改'):
            self.files.undo(result['record_id'])
        self.assertEqual((self.root / 'new.py').read_text(), 'value = 9\n')

    def test_second_write_failure_rolls_back_first_file(self):
        first = self.write('first.py', 'value = 1\n')
        self.write('second.py', 'value = 1\n')
        plan = self.files.prepare([self.change('first.py'), self.change('second.py')], '调整')
        replace = self.files.replace

        def fail_second(name, text):
            if name == 'second.py':
                raise OSError('disk failure')
            replace(name, text)

        with patch.object(self.files, 'replace', side_effect=fail_second):
            with self.assertRaisesRegex(ValueError, '已回退'):
                self.files.apply(plan)
        self.assertEqual(first.read_text(), 'value = 1\n')
        self.assertEqual(list(self.root.glob('.studio-edit-*')), [])
        self.assertEqual(len(list((self.root / module.PRIVATE_DIR).glob('*.json'))), 1)

    def test_atomic_replace_failure_keeps_original_and_cleans_temp(self):
        target = self.write('settings.json', '{"steps":1}')
        plan = self.files.prepare([self.change()], '调整')
        with patch.object(module.os, 'replace', side_effect=OSError('locked')):
            with self.assertRaises(ValueError):
                self.files.apply(plan)
        self.assertEqual(target.read_text(), '{"steps":1}')
        self.assertEqual(list(self.root.glob('.studio-edit-*')), [])

    def test_invalid_paths_and_private_files_rejected(self):
        for name in ['../other.py', 'a/../../x.py', 'D:/x.py', 'C:x.py', '//server/share', '\\outside', 'a.txt:secret', 'a./x', 'a /x', 'NUL.txt', 'COM1', 'CONIN$', 'CONOUT$', 'COM¹.txt', 'LPT².txt', '.git/config', '.env', '.env.local', 'comfy_studio.yaml', 'comfy_studio.yaml.tmp', 'custom_nodes/a/ai_key.txt', 'user/comfy_studio_agent/a.json', '.comfy_studio_maintenance/a.json']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.files.path(name)
        self.assertEqual(self.files.path('custom_nodes/plugin/a.py'), self.root / 'custom_nodes/plugin/a.py')

    def test_windows_short_name_cannot_bypass_private_file_guard(self):
        if os.name != 'nt':
            self.skipTest('Windows short path test')
        source = self.write('comfy_studio.yaml', 'secret')
        get_short = ctypes.windll.kernel32.GetShortPathNameW
        get_short.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint32]
        buffer = ctypes.create_unicode_buffer(4096)
        if not get_short(str(source), buffer, len(buffer)) or Path(buffer.value).name.lower() == source.name.lower():
            self.skipTest('8.3 aliases disabled on this volume')
        with self.assertRaisesRegex(ValueError, '凭据'):
            self.files.read(Path(buffer.value).name)

    def test_hardlink_cannot_read_or_edit_outside_file(self):
        with tempfile.TemporaryDirectory() as external:
            source = Path(external) / 'secret.txt'
            source.write_text('secret')
            os.link(source, self.root / 'link.txt')
            with self.assertRaisesRegex(ValueError, '硬链接'):
                self.files.read('link.txt')
            with self.assertRaises(ValueError):
                self.files.prepare([self.change('link.txt', 'secret', 'changed')], '修复')
            self.assertEqual(source.read_text(), 'secret')

    def test_directory_junction_is_not_traversed(self):
        if os.name != 'nt':
            self.skipTest('Windows junction test')
        with tempfile.TemporaryDirectory() as external:
            source = Path(external) / 'secret.txt'
            source.write_text('secret')
            junction = self.root / 'linked'
            quoted_link = str(junction).replace("'", "''")
            quoted_target = external.replace("'", "''")
            command = ['powershell', '-NoProfile', '-Command', f"New-Item -ItemType Junction -Path '{quoted_link}' -Target '{quoted_target}' | Out-Null"]
            result = subprocess.run(command, capture_output=True)
            if result.returncode:
                self.skipTest('Junction creation unavailable')
            try:
                with self.assertRaisesRegex(ValueError, '目录联接'):
                    self.files.read('linked/secret.txt')
                self.assertEqual(self.files.search('secret')['matches'], [])
            finally:
                os.rmdir(junction)

    def test_binary_oversized_invalid_utf8_and_syntax_rejected(self):
        self.write('model.safetensors', 'not text')
        self.write('huge.py', 'a' * (module.MAX_FILE + 1))
        (self.root / 'bad.txt').write_bytes(b'\xff')
        self.write('null.txt', 'a\0b')
        for name in ('model.safetensors', 'huge.py', 'bad.txt', 'null.txt'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.files.read(name)
        self.write('a.py', 'value = 1\n')
        self.write('UPPER.PY', 'value = 1\n')
        self.write('settings.json', '{"steps":1}')
        for change in (self.change('a.py', '1', '('), self.change('UPPER.PY', '1', '('), self.change(new='invalid')):
            with self.assertRaisesRegex(ValueError, '语法检查失败'):
                self.files.prepare([change], '修复')

    def test_ambiguous_replacement_duplicate_path_and_empty_old_rejected(self):
        self.write('a.py', 'value = 11\n')
        for changes in ([self.change('a.py')], [self.change('a.py', '', 'value = 2')], [self.change('a.py', '11', '2'), self.change('A.py', '', 'value = 3')]):
            with self.assertRaises(ValueError):
                self.files.prepare(changes, '修复')

    def test_list_metadata_read_lines_search_and_limits(self):
        self.write('models/large.safetensors', 'binary')
        self.write('.env', 'secret needle')
        self.write('a.py', 'a = 1\nb = 2 # needle\nc = 3\n')
        listed = self.files.list('models')
        self.assertEqual(listed['entries'][0]['bytes'], 6)
        self.assertEqual(self.files.read('a.py', start_line=2, lines=1)['text'], 'b = 2 # needle')
        self.assertEqual(self.files.read('a.py', lines=1, tail=True)['text'], 'c = 3')
        self.assertEqual(self.files.search('needle')['matches'], [{'path': 'a.py', 'line': 2, 'text': 'b = 2 # needle'}])
        self.write('many.txt', 'needle\n' * 70)
        searched = self.files.search('needle')
        self.assertTrue(searched['truncated'])
        self.assertEqual(len(searched['matches']), 60)
        for index in range(105):
            self.write(f'item{index}.txt', 'a')
        self.assertEqual(len(self.files.list()['entries']), 100)
        self.assertEqual(self.files.list()['next_offset'], 100)

    def test_large_log_tail_is_bounded_and_reads_latest_error(self):
        self.write('comfyui.log', '普通日志\n' * 50000 + 'latest ERROR CUDA\n')
        result = self.files.read('comfyui.log', lines=2, tail=True)
        self.assertIn('latest ERROR CUDA', result['text'])
        self.assertTrue(result['truncated'])
        self.assertIsNone(result['start_line'])
        self.assertLessEqual(len(result['text']), 20000)

    def test_undo_can_restore_original_invalid_code_and_root_cannot_change(self):
        self.write('broken.py', 'value = (\n')
        result = self.files.apply(self.files.prepare([self.change('broken.py', '(', '1')], '修复语法'))
        undo = self.files.undo(result['record_id'])
        self.files.apply(undo)
        self.assertEqual((self.root / 'broken.py').read_text(), 'value = (\n')
        with tempfile.TemporaryDirectory() as other:
            with self.assertRaisesRegex(ValueError, '根目录已改变'):
                module.ProjectFiles(other).apply(undo)


if __name__ == '__main__':
    unittest.main()
