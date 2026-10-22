import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('market_validator', Path(__file__).resolve().parents[1]/'scripts/validate_market.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class MinimumVersionChecks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='xhp-minimum-check-')
        self.root = Path(self.temporary.name).resolve()
        self.original_root = validator.ROOT
        validator.ROOT = self.root

    def tearDown(self):
        validator.ROOT = self.original_root
        assert self.root.parent == Path(tempfile.gettempdir()).resolve()
        self.temporary.cleanup()

    def package(self, minimum='1.5.0'):
        manifest = dict(id='dev.test.minimum', name='fixture', version='1.0.0', author='fixture', description='fixture',
                        protocolVersion=3, entryUrl='about:blank', capabilities=['web_ui','semester_export','lan_connect'], activation={'type':'web'})
        if minimum is not None:
            manifest['minAppVersion'] = minimum
        source = self.root/'plugins/dev.test.minimum'
        source.mkdir(parents=True)
        (source/'plugin.json').write_text(json.dumps(manifest),encoding='utf-8')
        (source/'main.js').write_text('void 0;',encoding='utf-8')
        relative='packages/dev.test.minimum/1.0.0/fixture.xhp'
        target=self.root/relative
        target.parent.mkdir(parents=True)
        with zipfile.ZipFile(target,'w') as archive:
            for name in ['plugin.json','main.js']: archive.write(source/name,name)
        entry=dict(id=manifest['id'],latestVersion='1.0.0',protocolVersion=3,minAppVersion='1.5.0',minAppVersionCode=29,
                   packagePath=relative,sha256=hashlib.sha256(target.read_bytes()).hexdigest())
        return entry,source,manifest

    def test_current_package_declares_floor_and_validates(self):
        entry,source,manifest=self.package()
        validator.validate_manifest(manifest,entry['id'])
        validator.validate_package(entry,source)

    def test_a_new_package_without_floor_cannot_reuse_legacy_exception(self):
        entry,source,_=self.package(None)
        with self.assertRaisesRegex(validator.ValidationError,'explicitly declare'):
            validator.validate_package(entry,source)

    def test_market_cannot_understate_manifest_minimum(self):
        entry,source,_=self.package()
        entry['minAppVersion']='1.4.99'
        with self.assertRaisesRegex(validator.ValidationError,'understates'):
            validator.validate_package(entry,source)

    def test_connect_api_requires_1_5_0_and_internal_29(self):
        entry,source,_=self.package('1.4.0')
        with self.assertRaisesRegex(validator.ValidationError,'requires host 1.5.0'):
            validator.validate_package(entry,source)

    def test_invalid_present_floor_is_not_treated_as_missing(self):
        _,_,manifest=self.package('')
        with self.assertRaisesRegex(validator.ValidationError,'minAppVersion'):
            validator.validate_manifest(manifest,manifest['id'])


if __name__ == '__main__':
    unittest.main()
