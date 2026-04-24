main.floors.MT241=
{
    "floorId": "MT241",
    "title": "241 层",
    "name": "241 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "03.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 100000,
    "defaultGround": 919,
    "bgm": "16.mp3",
    "firstArrive": [
        {
            "type": "setCurtain",
            "time": 1000
        },
        "被厚厚的积雪所包裹的银白世界中，\n两个女孩站在一座雪山顶端，\n俯瞰着茫茫的白色大地。",
        "\t[纳可]好冷啊…姐姐。\n奇怪，为什么燕岗领地图上，\n没有这片雪原的标注？",
        "\t[纳娜米]这里，应该就是那神秘强者峰说的地方了。\n环境确实很恶劣，极端的低温，\n估计大地级在这里都有冻死的危险。",
        "\t[纳可]受不了呀，太冷了，\n还是张开火焰领域取暖吧。\n姐姐快靠过来一点。",
        "\t[纳娜米]不要把领域用来做这个啊！\n为了应对未知的危险，\n还是尽可能保存足够的体力更好吧！",
        "\t[纳可]唔，也对，那就只能忍一忍了……",
        "纳娜米加入了队伍！\n协同作战，能力的效力增加了3%！",
        {
            "type": "hide",
            "loc": [
                [
                    6,
                    4
                ]
            ],
            "remove": true
        },
        {
            "type": "if",
            "condition": "(item:I821>=0.1)",
            "true": [
                "系统提示：\n检测到纳娜米已在队伍中。\n…………怎么说呢，嗯。",
                "你能够看到这一条提示，\n对游戏的理解真的相当深刻呀！\n不得不说，非常不错。",
                "那请问你的姐姐是这只10%加成的呢，\n还是3%加成的呢？",
                {
                    "type": "choices",
                    "choices": [
                        {
                            "text": "3%",
                            "action": [
                                "骗人，你明明就留了10%加成的那只！",
                                "所以，你掉的这两只姐姐，\n我就都收回去了。\n开玩笑的，不过省能力加成就不要想了！"
                            ]
                        },
                        {
                            "text": "10%",
                            "action": [
                                "骗人，这一次的姐姐明明只给你3%加成的！",
                                "所以，你掉的这两只姐姐，\n我就都收回去了。\n开玩笑的，不过省能力加成就不要想了！"
                            ]
                        },
                        {
                            "text": "30%",
                            "action": [
                                "骗人吧……\n这一只都可以省下来的？！\n你是羽月本月吗！"
                            ]
                        }
                    ]
                },
                "以及，看在你前面打得那么辛苦……\n收下这些吧，给聪明者的奖励。\n你肯定会喜欢的。",
                {
                    "type": "setValue",
                    "name": "item:I1034",
                    "value": "1"
                },
                "获得了幸运数字 - 9！\n获得了幸运数字补充道具：\n三种基础道具*1。",
                {
                    "type": "setValue",
                    "name": "item:redKey",
                    "operator": "+=",
                    "value": "1"
                },
                {
                    "type": "setValue",
                    "name": "item:pickaxe",
                    "operator": "+=",
                    "value": "1"
                },
                {
                    "type": "setValue",
                    "name": "item:centerFly",
                    "operator": "+=",
                    "value": "1"
                },
                {
                    "type": "setValue",
                    "name": "flag:241f",
                    "value": "1"
                }
            ],
            "false": [
                {
                    "type": "follow",
                    "name": "nanami.png"
                }
            ]
        },
        {
            "type": "setValue",
            "name": "item:I821",
            "value": "0.03"
        },
        {
            "type": "hide",
            "loc": [
                [
                    6,
                    6
                ]
            ],
            "floorId": "MT179",
            "remove": true
        },
        {
            "type": "hide",
            "loc": [
                [
                    6,
                    2
                ]
            ],
            "floorId": "MT52",
            "remove": true
        },
        {
            "type": "hide",
            "loc": [
                [
                    6,
                    6
                ]
            ],
            "floorId": "MT52",
            "remove": true
        }
    ],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,4": {
            "trigger": "action",
            "enable": true,
            "noPass": null,
            "displayDamage": false,
            "opacity": 1,
            "filter": {
                "blur": 0,
                "hue": 0,
                "grayscale": 0,
                "invert": false,
                "shadow": 0
            },
            "data": []
        }
    },
    "changeFloor": {
        "6,1": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "6,11": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [ 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20],
    [ 20, 20, 20, 20, 20, 20, 88, 20, 20, 20, 20, 20, 20],
    [ 20, 20, 20, 20, 20,  0,  0,  0, 20, 20, 20, 20, 20],
    [ 20, 22, 20, 20,  0,  0,  0,  0,  0, 20, 20, 22, 20],
    [ 20, 21, 20, 20, 20,  0,1247,  0, 20, 20, 20, 21, 20],
    [ 20, 15, 20, 20, 20, 20, 86, 20, 20, 20, 20, 15, 20],
    [ 20, 22, 15, 20, 20,533,  0, 81, 20, 20, 15, 22, 20],
    [ 20, 20, 22, 15, 59,  0, 20,533, 59, 15, 22, 20, 20],
    [ 20, 20, 20, 20,534, 20, 20, 20, 81, 20, 20, 20, 20],
    [ 20, 82,1006, 82, 59, 20, 20, 20, 59, 82,1006, 82, 20],
    [ 20,1006, 20,  0,535,576,  0,577,533,  0, 20,1006, 20],
    [1006, 82, 20, 83, 20,  0, 87,  0, 20, 83, 20, 82,1006],
    [ 20, 20, 20, 47, 20, 20, 20, 20, 20, 50, 20, 20, 20]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

],
    "weather": [
        "snow",
        2
    ]
}