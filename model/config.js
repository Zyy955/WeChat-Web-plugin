import fs from "fs"
import Yaml from "yaml"

const _path = "./plugins/WeChat-Web-plugin/config"

/** 检查配置文件是否存在 */
if (!fs.existsSync(_path + "/config.yaml")) {
  fs.copyFileSync(_path + "/defSet/config.yaml", _path + "/config.yaml")
}

/** 兼容旧配置文件 */
let old = fs.readFileSync(_path + "/config.yaml", "utf8")
if (!old.match(RegExp("SetID:"))) {
  old = old + `\n# 设置微信id模式 1-仅主人可用 0-所有人可用\nSetID: 1`
  fs.writeFileSync(_path + "/config.yaml", old, "utf8")
}

const cfg = Yaml.parse(fs.readFileSync(_path + "/config.yaml", "utf8"))

export { cfg }
