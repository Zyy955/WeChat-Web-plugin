import "./model/loader.js"
import fs from "fs"
import path from "path"
import _Yaml from "./model/yaml.js"
import crypto from "crypto"
import Wechat from "wechat4u"
import fetch from "node-fetch"
import { execSync } from "child_process"
import { WeiXin } from "./model/loader.js"
import { update } from "../other/update.js"
import { fileTypeFromBuffer } from "file-type"
import PluginsLoader from "../../lib/plugins/loader.js"
import { cfg } from "./model/config.js"


let bot = {}
/** 设置主人 */
let user = ""
let sign = {}

const adapter = new class WeChat {
    constructor() {
        this.name = "WeChat-Web"
        this._path = process.cwd() + "/plugins/WeChat-Web-plugin"
        this._data = this._path + "/data"
    }

    addbot(id) {
        /** 接收消息 */
        bot[id].on('message', async msg => {
            await this.makeMessage(id, msg)
        })

        /** 登出 */
        bot[id].on('logout', () => {
            logger.info('登出成功')
            // 清除数据
            fs.unlinkSync(`${this._data}/data/${id}.json`)
        })

        /** 捕获错误 */
        bot[id].on('error', err => {
            logger.error('错误：', err?.tips || err)
            logger.debug('错误：', err)
        })
    }
    /** 处理接收的消息 */
    async makeMessage(id, msg) {
        /** 屏蔽bot自身消息 */
        if (msg.isSendBySelf) return
        /** 屏蔽历史消息 */
        if (Math.floor(Date.now() / 1000) - msg.CreateTime > 10) return

        let atBot = false
        /** 当前机器人群聊列表 */
        const group_list = bot[id].contacts[msg.FromUserName].MemberList
        if (Array.isArray(group_list)) {
            for (let i of group_list) {
                const regexp = new RegExp(`@${i.DisplayName}`)
                /** 通过正则匹配群名片的方式来查询是否atBot */
                if (regexp.test(msg.Content)) atBot = true; break
            }
        }

        let group_id
        let user_id = `wx_${msg.FromUserName}`


        let sub_type = "friend"
        let message_type = "private"
        /** 群聊 */
        if (/^@@/.test(msg.FromUserName)) {
            sub_type = "normal"
            message_type = "group"
            group_id = `wx_${msg.FromUserName}`
            user_id = `wx_${msg.OriginalContent.split(":")[0]}`

        }

        /** 从redis中读取id */
        let _user_id = await redis.get(user_id)
        _user_id ? user_id = _user_id : user_id
        let _group_id = await redis.get(group_id)
        _group_id ? group_id = _group_id : group_id


        /**
         * 根据官方文档的说法
         * Msg.ToUserName = 接收用户
         * Msg.FromUserName = 发送用户，回复消息用此id，带@@=群聊id，单@=好友id
         */

        let toString = ""
        const message = []
        /** 用户昵称 */
        const nickname = msg.Content.split(":")[0]
        /** 机器人uin */
        const uin = msg.ToUserName
        /** 机器人名称 */
        const bot_name = bot[id].user.NickName
        /** 发送用户，回复消息用 */
        const from = msg.FromUserName
        /** 群名称 */
        const group_name = bot[id].contacts[msg.FromUserName].getDisplayName().replace("[群] ", "")
        const log = !/^@@/.test(from) ?
            `好友消息(${bot_name})：[${nickname}(${from})]`
            : `群消息(${bot_name})：[${group_name}(${from})，${nickname}(${msg.OriginalContent.split(":")[0]})]`

        switch (msg.MsgType) {
            /** 文本 */
            case bot[id].CONF.MSGTYPE_TEXT:
                const text = msg.Content?.match(/\n(.+)/)?.[1] || msg.Content
                message.push({ type: "text", text: text })
                toString += text
                logger.info(`${log} ${text}`)
                break

            /** 图片 */
            case bot[id].CONF.MSGTYPE_IMAGE:
                await bot[id].getMsgImg(msg.MsgId)
                    .then(res => {
                        const md5 = msg.Content.match(/md5=".*?"/)[0].replace(/md5|=|"/g, "")
                        const _path = `${this._data}/image/${md5}.jpg`
                        fs.writeFileSync(_path, res.data)
                        logger.info(`${log} [图片：${_path}]`)
                        message.push({ type: "image", file: _path })
                        toString += `{image:${_path}}`
                    })
                    .catch(err => { bot[id].emit('error', err?.tips) })
                break

            /** 语音消息 */
            case bot[id].CONF.MSGTYPE_VOICE:
                break

            /** 表情消息 */
            case bot[id].CONF.MSGTYPE_EMOTICON:
                await bot[id].getMsgImg(msg.MsgId)
                    .then(res => {
                        const md5 = msg.Content.match(/md5=".*?"/)[0].replace(/md5|=|"/g, "")
                        const _path = `${this._data}/gif/${md5}.gif`
                        if (!fs.existsSync(_path)) fs.writeFileSync(_path, res.data)
                        logger.info(`${log} [动态表情：${_path}]`)
                        message.push({ type: "image", file: _path })
                    })
                    .catch(err => { bot[id].emit('error', err?.tips) })
                break

            /** 视频消息 */
            case bot[id].CONF.MSGTYPE_VIDEO:
                break

            /** 小视频消息 */
            case bot[id].CONF.MSGTYPE_MICROVIDEO:
                break

            /** 文件消息 */
            case bot[id].CONF.MSGTYPE_APP:
                break

            /** 好友请求消息 */
            case bot[id].CONF.MSGTYPE_VERIFYMSG:
                if (!cfg.autoFriend) {
                    break
                }
                bot[id].verifyUser(msg.RecommendInfo.UserName, msg.RecommendInfo.Ticket)
                    .then(res => {
                        logger.info(`通过了 ${bot[id].Contact.getDisplayName(msg.RecommendInfo)} 好友请求`)
                    })
                    .catch(err => {
                        bot[id].emit('error', err)
                    })
                break

            default:
                break
        }

        let member = {
            info: {
                group_id: group_id,
                user_id: user_id,
                nickname: nickname,
                last_sent_time: msg.CreateTime,
            },
            group_id: group_id,
        }

        let e = {
            atBot: atBot,
            atme: atBot,
            adapter: "WeXin",
            uin: uin,
            post_type: "message",
            message_id: msg.MsgId,
            user_id: user_id,
            time: msg.CreateTime,
            raw_message: toString,
            message_type: message_type,
            sub_type: sub_type,
            sender: {
                user_id: user_id,
                nickname: nickname,
                card: nickname,
                role: "member",
            },
            source: "",
            group_id: group_id,
            group_name: group_name,
            self_id: uin,
            seq: msg.MsgId,
            member,
            friend: {
                recallMsg: (MsgID) => {
                    return bot[id].revokeMsg(MsgID, from)
                },
                makeForwardMsg: async (forwardMsg) => {
                    return await this.makeForwardMsg(forwardMsg, toString)
                },
                getChatHistory: (seq, num) => {
                    return ["message", "test"]
                },
                sendMsg: async (reply) => {
                    return await this.reply(id, msg, reply)
                },
            },
            group: {
                getChatHistory: (seq, num) => {
                    return ["message", "test"]
                },
                recallMsg: (MsgID) => {
                    return bot[id].revokeMsg(MsgID, from)
                },
                sendMsg: async (reply) => {
                    return await this.reply(id, msg, reply)
                },
                makeForwardMsg: async (forwardMsg) => {
                    return await this.makeForwardMsg(forwardMsg, toString)
                }
            },
            recall: (MsgID) => {
                return bot[id].revokeMsg(MsgID, from)
            },
            reply: async (reply) => {
                return await this.reply(id, msg, reply)
            },
            toString: () => {
                return toString
            }
        }
        /** 兼容message不存在的情况 */
        if (message) e.message = [...message]
        PluginsLoader.deal(e)
    }

    /** 处理回复消息格式、回复日志 */
    async reply(id, msg, reply) {
        /** 用户昵称 */
        const nickname = msg.Content.split(":")[0]
        /** 机器人名称 */
        const bot_name = bot[id].user.NickName
        /** 发送用户，回复消息用 */
        const from = msg.FromUserName
        /** 群名称 */
        const group_name = bot[id].contacts[msg.FromUserName].getDisplayName().replace("[群] ", "")
        const log = !/^@@/.test(from) ? `发送好友消息(${bot_name})：[${nickname}(${from})]` : `发送群消息(${bot_name})：[${group_name}(${from})]`
        const data = { id: id, msg: msg, log: log }
        return await this.type(data, reply)
    }

    /** 转换云崽过来的格式，回复消息 */
    async type(data, message) {
        let res
        const { id, msg, log } = data

        if (message?.data?.type === "test") message = message.msg
        if (!Array.isArray(message)) message = [message]

        for (let i of message) {
            if (typeof i === "string") i = { type: "text", text: i }
            switch (i.type) {
                case "image":
                    const res_img = await this.get_image(data, i)
                    logger.info(log + JSON.stringify(res_img.log))
                    res = res_img.res
                    break
                case "text":
                    logger.info(log + JSON.stringify(i.text))
                    res = await this.sendMsg(id, i.text, msg.FromUserName)
                    break
                case "at":
                    break
                case "file":
                    break
                case "forward":
                    logger.info(log + JSON.stringify(i.text))
                    res = await this.sendMsg(id, i.text, msg.FromUserName)
                    break
                case "emoji":
                    break
                default:
                    logger.info(log + JSON.stringify(i))
                    res = await this.sendMsg(id, JSON.stringify(i), msg.FromUserName)
                    break
            }
        }
    }


    /** 处理各种图片格式 */
    async get_image(data, i) {
        let log = "[图片：base64://...]"
        let name
        let file = i.file

        /** 特殊格式？... */
        if (file?.type === "Buffer") {
            file = file.data
            name = await this.img_name(file.data)
        }

        /** Uint8Array */
        else if (file instanceof Uint8Array) {
            name = await this.img_name(file)
        }

        /** 天知道从哪里蹦出来的... */
        else if (file instanceof fs.ReadStream) {
            name = path.basename(`./${file.path}`)
            file = fs.readFileSync(`./${file.path}`)
        }

        /** base64字符串 */
        else if (typeof file === "string" && /^base64:\/\//.test(file)) {
            file = Buffer.from(file.replace(/^base64:\/\//, ""), "base64")
            name = await this.img_name(file)
        }

        /** 本地文件 */
        else if (typeof file === "string" && fs.existsSync(file.replace(/^file:[/]{0,3}/, ""))) {
            log = `[图片：${file}]`
            name = path.basename(file.replace(/^file:[/]{0,3}/, ""))
            file = fs.readFileSync(file.replace(/^file:[/]{0,3}/, ""))
        }

        /** url图片 */
        else if (typeof file === "string" && /^http(s)?:\/\//.test(file)) {
            log = `[图片：${file}]`
            name = file.match(/\/([^/]+)$/)?.[1] || `${Date.now()}.png`
            file = Buffer.from(await (await fetch(file)).arrayBuffer())
        }

        /** 留个容错防止炸了 */
        else {
            return { res: "", log: "未知图片格式...请寻找作者适配..." }
        }

        data.file = file
        data.name = name
        const res = await this.sendImg(data)
        return { res, log }
    }

    /** 获取图片名称 */
    async img_name(data) {
        const name = await fileTypeFromBuffer(data)
        return `${Date.now()}.${name.ext}`
    }

    /** 当然是发送图片啦 */
    async sendImg(data) {
        const { id, file, name, msg } = data
        for (let i = 0; i < 3; i++) {
            try {
                const res = await bot[id].sendMsg({ file: file, filename: name }, msg.FromUserName)
                /** 返回消息id给撤回用？ */
                return {
                    seq: res.MsgID,
                    rand: 1,
                    time: parseInt(Date.now() / 1000),
                    message_id: res.MsgID
                }
            } catch (err) {
                bot[id].emit('error', err)
                if (i === 2) {
                    await this.sendMsg(id, `图片发送错误：${err?.tips}`, msg.FromUserName)
                    return logger.error('发送消息失败:', err?.tips)
                }
            }
        }
    }

    /** 发送消息 */
    async sendMsg(id, msg, Name) {
        const res = await bot[id].sendMsg(msg, Name)
        try {
            /** 返回消息id给撤回用？ */
            return {
                seq: res.MsgID,
                rand: 1,
                time: parseInt(Date.now() / 1000),
                message_id: res.MsgID
            }
        } catch (err) {
            return err
        }
    }

    /** 转发 */
    async makeForwardMsg(forwardMsg, toString = "") {
        const messages = {}
        const newmsg = []

        /** 针对无限套娃的转发进行处理 */
        for (const i_msg of forwardMsg) {
            const formsg = i_msg?.message
            if (formsg && typeof formsg === "object") {
                /** 套娃转发 */
                if (formsg?.data?.type === "test" || formsg?.type === "xml") {
                    newmsg.push(...formsg.msg)
                } else if (Array.isArray(formsg)) {
                    for (const arr of formsg) {
                        if (typeof arr === "string") newmsg.push({ type: "forward", text: arr })
                        else newmsg.push(arr)
                    }
                } else {
                    /** 普通对象 */
                    newmsg.push(formsg)
                }
            } else {
                /** 日志特殊处理 */
                if (toString && /^#.*日志$/.test(toString)) {
                    let splitMsg
                    for (const i of forwardMsg) {
                        splitMsg = i.message.split("\n[").map(element => {
                            if (element.length > 100)
                                element = element.substring(0, 100) + "日志过长..."
                            return { type: "forward", text: `[${element.trim()}\n` }
                        })
                    }
                    newmsg.push(...splitMsg.slice(0, 50))
                } else {
                    /** 正常文本 */
                    newmsg.push({ type: "forward", text: formsg })
                }
            }
        }
        /** 对一些重复元素进行去重 */
        messages.msg = Array.from(new Set(newmsg.map(JSON.stringify))).map(JSON.parse)
        messages.data = { type: "test", text: "forward", app: "com.tencent.multimsg", meta: { detail: { news: [{ text: "1" }] }, resid: "", uniseq: "", summary: "" } }
        return messages
    }


    async login(Jsons) {
        for (let id of Jsons) {
            id = id.replace(".json", "")
            try {
                bot[id] = new Wechat(JSON.parse(fs.readFileSync(`${this._data}/data/${id}.json`)))
                /** 启动机器人 */
                if (bot[id].PROP.uin) bot[id].restart()
                adapter.addbot(id)
                /** 登录成功 */
                bot[id].on('login', () => {
                    logger.info('登录成功')
                    // 保存数据，将数据序列化之后保存到任意位置
                    fs.writeFileSync(`${this._data}/data/${id}.json`, JSON.stringify(bot[id].botData))

                    /** 米游社主动推送、椰奶状态pro */
                    if (!Bot?.adapter) {
                        Bot.adapter = [Bot.uin]
                        Bot.adapter.push(id)
                    } else {
                        Bot.adapter.push(id)
                        /** 去重防止断连后出现多个重复的id */
                        Bot.adapter = Array.from(new Set(Bot.adapter.map(JSON.stringify))).map(JSON.parse)
                    }
                    Bot[id] = {
                        uin: id,
                        nickname: bot[id].user.NickName,
                        avatar: bot[id].CONF.origin + bot[id].user.HeadImgUrl, // 头像...
                        stat: { start_time: Date.now() / 1000, recv_msg_cnt: Bot.uin.stat?.recv_msg_cnt || "未知" },
                        apk: { display: WeiXin.cfg.name, version: WeiXin.cfg.ver },
                        fl: new Map(),
                        gl: new Map(),
                        version: { id: "wx", name: "微信Bot", version: WeiXin.cfg.bot.replace("^", "") },
                        pickGroup: (groupId) => {
                            return {
                                sendMsg: (reply, reference = false) => {
                                    // return ws.reply(groupId, reply, reference)
                                },
                                makeForwardMsg: async (forwardMsg) => {
                                    return await this.makeForwardMsg(forwardMsg)
                                },
                            }
                        }
                    }
                })
            } catch (err) {
                logger.error(err)
            }
        }
    }
}

export class WebWcChat extends plugin {
    constructor() {
        super({
            name: "微信",
            dsc: "网页版微信机器人",
            event: "message",
            priority: 1,
            rule: [
                {
                    reg: "^#微信登录$",
                    fnc: "login"
                },
                {
                    reg: "^#微信账号$",
                    fnc: "account"
                },
                {
                    reg: "^#微信删除.*$",
                    fnc: "delUser"
                },
                {
                    reg: /^#(微信|WeChat)(插件)?(强制)?更新(日志)?$/gi,
                    fnc: "update",
                    permission: "master"
                },
                {
                    reg: /^#设置主人$/,
                    fnc: 'master'
                },
                {
                    reg: /^#(删除|取消)主人$/,
                    fnc: "del_master",
                    permission: "master"
                },
                {
                    reg: /^#微信设置(群)?id/i,
                    fnc: "setId",
                },
            ]
        })

    }


    async setId() {
        const msg = this.e.msg.replace(/#微信设置(群)?id/gi, "").trim()
        if (!msg) return this.reply("ID呢？")
        if (this.e.msg.includes("群") && this.e.isMaster) {
            await redis.set(this.e.group_id, `wx_${msg}`)
            return this.reply("设置成功")
        }

        const cfg = new _Yaml("./config/config/other.yaml")
        /** 检测用户是否已经是主人 */
        if (cfg.value("masterQQ", `wx_${msg}`) && !this.e.isMaster)
            return this.reply("你不是主人，不可以改成主人的id啦！")

        if (this.e.user_id.includes("wx_*") && !this.e.isMaster) {
            return this.reply("你已经更换过一次了，请联系主人为您更换~")
        }
        if (cfg?.SetID == 1 && !this.e.isMaster) {
            if (await redis.get(`${this.e.user_id}`)) {
                return this.reply(`你已经绑定过id了，当前模式为仅主人可更改，普通用户仅可绑定不可更改。`)
            }
        }

        await redis.set(this.e.user_id, `wx_${msg}`)
        return this.reply("绑定成功~")
    }

    async login() {
        const id = parseInt(Date.now() / 1000)
        bot[id] = new Wechat()
        bot[id].start()
        adapter.addbot(id)
        /** uuid事件，参数为uuid，根据uuid生成二维码 */
        bot[id].on('uuid', async uuid => {
            const url = "https://login.weixin.qq.com/qrcode/" + uuid
            logger.info('二维码链接：', url)
            const response = await fetch(url)
            const buffer = await response.arrayBuffer()
            this.e.reply([segment.image(Buffer.from(buffer)), "请扫码登录"], false, { recall: 10 })
        })

        /** 登录成功 */
        bot[id].on('login', () => {
            this.e.reply("登录成功")
            // 保存数据，将数据序列化之后保存到任意位置
            fs.writeFileSync(`${process.cwd()}/plugins/WeChat-Web-plugin/data/data/${id}.json`, JSON.stringify(bot[id].botData))

            /** 米游社主动推送、椰奶状态pro */
            if (!Bot?.adapter) {
                Bot.adapter = [Bot.uin]
                Bot.adapter.push(id)
            } else {
                Bot.adapter.push(id)
                /** 去重防止断连后出现多个重复的id */
                Bot.adapter = Array.from(new Set(Bot.adapter.map(JSON.stringify))).map(JSON.parse)
            }
            Bot[id] = {
                uin: id,
                nickname: bot[id].user.NickName,
                avatar: bot[id].CONF.origin + bot[id].user.HeadImgUrl, // 头像...
                stat: { start_time: Date.now() / 1000 },
                apk: { display: WeiXin.cfg.name, version: WeiXin.cfg.ver },
                fl: new Map(),
                gl: new Map(),
                version: { id: "wx", name: "微信Bot", version: WeiXin.cfg.bot.replace("^", "") },
                pickGroup: (groupId) => {
                    return {
                        sendMsg: (reply, reference = false) => {
                            // return ws.reply(groupId, reply, reference)
                        },
                        makeForwardMsg: async (forwardMsg) => {
                            return await this.makeForwardMsg(forwardMsg)
                        },
                    }
                }
            }
        })
    }

    async account() {
        const user = []
        const file = fs.readdirSync('./plugins/WeChat-Web-plugin/data/data')
        const account = file.filter(file => file.endsWith('.json'))
        for (let id of account) {
            id = id.replace(".json", "")
            user.push(`${id}：${bot[id].user.NickName}`)
        }
        this.e.reply(`账号列表(ID:名称)：\n${user.join('\n')}\n\n如需删除指定账号，请使用 #微信删除+ID 进行删除账号`)
    }

    async delUser() {
        const msg = this.e.msg.replace(/#微信删除/, "").trim()
        const _path = `./plugins/WeChat-Web-plugin/data/data/${msg}.jsom`
        if (fs.existsSync(_path)) {
            fs.unlinkSync(_path)
            this.e.reply(`账号 ${msg} 已删除，重启后生效`)
        } else {
            this.e.reply(`账号 ${msg} 不存在`)
        }
    }


    async update(e) {
        let new_update = new update()
        new_update.e = e
        const name = "WeChat-Web-plugin"
        if (new_update.getPlugin(name)) {
            if (e.msg.includes("更新日志")) {
                if (new_update.getPlugin(name)) {
                    return e.reply(await new_update.getLog(name))
                }
            } else {
                if (this.e.msg.includes('强制'))
                    execSync('git reset --hard', { cwd: `${process.cwd()}/plugins/${name}/` })
                await new_update.runUpdate(name)
                if (new_update.isUp)
                    setTimeout(() => new_update.restart(), 2000)
            }
            return false
        }
    }

    async master(e) {
        let user_id = e.user_id
        if (e.at) {
            const cfg = new _Yaml("./config/config/other.yaml")
            /** 存在at检测触发用户是否为主人 */
            if (!e.isMaster) return e.reply(`只有主人才能命令我哦~\n(*/ω＼*)`)
            user_id = e.at
            /** 检测用户是否已经是主人 */
            if (cfg.value("masterQQ", user_id)) return e.reply([segment.at(user_id), "已经是主人了哦(〃'▽'〃)"])
            /** 添加主人 */
            return await e.reply(apps.master(e, user_id))
        } else {
            /** 检测用户是否已经是主人 */
            if (e.isMaster) return e.reply([segment.at(e.user_id), "已经是主人了哦(〃'▽'〃)"])
        }
        /** 生成验证码 */
        sign[user_id] = crypto.randomUUID()
        logger.mark(`设置主人验证码：${logger.green(sign[e.user_id])}`)
        await e.reply([segment.at(e.user_id), `请输入控制台的验证码`])
        /** 开始上下文 */
        return await this.setContext('SetAdmin')
    }

    async del_master(e) {
        // const file = _path
        if (!e.at) return e.reply("你都没有告诉我是谁！快@他吧！^_^")
        const cfg = new _Yaml("./config/config/other.yaml")
        /** trss */
        if (cfg.hasIn("master")) {
            if (!cfg.value("master", e.at)) {
                return e.reply("这个人不是主人啦(〃'▽'〃)", false, { at: true })
            }
            cfg.delVal("master", e.at)
            cfg.delVal("masterQQ", `${e.self_id}:${e.at}`)
        }
        /** 喵 */
        else {
            if (!cfg.value("masterQQ", e.at)) {
                return e.reply("这个人不是主人啦(〃'▽'〃)", false, { at: true })
            }
            cfg.delVal("masterQQ", e.at)
        }
        e.reply([segment.at(e.at), "拜拜~"])
    }

    SetAdmin() {
        /** 结束上下文 */
        this.finish('SetAdmin')
        /** 判断验证码是否正确 */
        if (this.e.msg.trim() === sign[this.e.user_id]) {
            this.e.reply(apps.master(this.e))
        } else {
            return this.reply([segment.at(this.e.user_id), "验证码错误"])
        }
    }
}

/** 读取现有的进行登录 */
const file = fs.readdirSync('./plugins/WeChat-Web-plugin/data/data')
const Jsons = file.filter(file => file.endsWith('.json'))
if (Jsons.length > 0) {
    adapter.login(Jsons)
}



let apps = {
    /** 设置主人 */
    master(e, user_id = null) {
        user_id = user_id || e.user_id
        const cfg = new _Yaml("./config/config/other.yaml")
        /** trss */
        if (cfg.hasIn("master")) {
            cfg.addVal("master", user_id)
            cfg.addVal("masterQQ", `${e.self_id}:${user_id}`)
        }
        /** 喵 */
        else {
            cfg.addVal("masterQQ", user_id)
        }
        return [segment.at(user_id), "新主人好~(*/ω＼*)"]
    },

    /** 添加Bot */
    async addBot(e) {
        const cmd = e.msg.replace(/^#QQ频道设置/gi, "").replace(/：/g, ":").trim().split(':')
        if (!/^1\d{8}$/.test(cmd[2])) return "appID 错误！"
        if (!/^[0-9a-zA-Z]{32}$/.test(cmd[3])) return "token 错误！"

        let bot
        const cfg = new _Yaml(_path + "/bot.yaml")
        /** 重复的appID，删除 */
        if (cfg.hasIn(cmd[2])) {
            cfg.del(cmd[2])
            return `Bot：${Bot[cmd[2]].name}${cmd[2]} 删除成功...重启后生效...`
        } else {
            bot = { appID: cmd[2], token: cmd[3], sandbox: cmd[0] === "1", allMsg: cmd[1] === "1" }
        }

        /** 保存新配置 */
        cfg.addIn(cmd[2], bot)
        try {
            await (new guild).monitor([bot])
            return `Bot：${Bot[cmd[2]].name}(${cmd[2]}) 已连接...`
        } catch (err) {
            return err
        }
    }
}
