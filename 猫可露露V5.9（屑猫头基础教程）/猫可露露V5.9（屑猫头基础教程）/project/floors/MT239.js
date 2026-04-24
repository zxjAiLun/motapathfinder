main.floors.MT239=
{
    "floorId": "MT239",
    "title": "239 层",
    "name": "239 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 50000,
    "defaultGround": 90000,
    "bgm": "15.mp3",
    "color": null,
    "weather": null,
    "firstArrive": [
        {
            "type": "moveHero",
            "time": 300,
            "steps": [
                "left:3"
            ]
        },
        {
            "type": "changePos",
            "direction": "right"
        },
        "\t[纳可]呼啊——终于出了那片黑漆漆的森林。\n果然还是外面更舒服。",
        "\t[雷冬]峰大人，这城里我非常熟，\n如果您有什么想去的地方……",
        "\t[峰]不必了……我们就在此分开吧。",
        "\t[纳可]分开……吗？\n（峰大哥他，好像不想和我们有太大的牵扯。）",
        "就要与这位很好相处的超级强者分别，\n纳可眼中掠过一抹失落。\n峰看向她，似乎察觉到了什么。",
        "\t[峰]对了，这燕岗城最好的住宿地是哪里？",
        "\t[纳可]飞云阁。",
        "\t[峰]嗯，如果你想找我，就去飞云阁吧。",
        "\t[纳可]……诶？！",
        "少女愣在原地，\n一转眼，黑甲青年已经朝城门方向走去，\n身影模糊，瞬间就到了远处。",
        "\t[雷冬]小姐……我们回去吧。\n这位峰大人的事情，最好还是告诉老爷。\n特别是百家的事，也得说，我感觉不是小事。",
        {
            "type": "setCurtain",
            "color": [
                0,
                0,
                0,
                1
            ],
            "time": 1000,
            "keep": true
        },
        "峰离开了队伍。",
        {
            "type": "unfollow",
            "name": "feng.png"
        },
        {
            "type": "setCurtain",
            "time": 1000
        }
    ],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "4,5": {
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
            "data": [
                "\t[燕岗城守卫]竟然是纳可小姐回来了？\n快请进城吧。"
            ]
        },
        "4,7": {
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
            "data": [
                "\t[燕岗城守卫]竟然是纳可小姐回来了？\n快请进城吧。"
            ]
        }
    },
    "changeFloor": {
        "11,6": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "1,6": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {
        "2,6": [
            {
                "type": "setCurtain",
                "color": [
                    0,
                    0,
                    0,
                    1
                ],
                "time": 1000,
                "keep": true
            },
            {
                "type": "changeFloor",
                "floorId": "MT240",
                "loc": [
                    3,
                    5
                ],
                "direction": "right"
            }
        ]
    },
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [173,173,173,173,173,173,173,173,173,173,173,173,173],
    [173,173,173,150,150,150,150,150,150,150,150,173,173],
    [150,150,150,150,150,150,150,150,150,150,150,150,150],
    [150,150,150,150,150,150,150,150,150,150,150,150,150],
    [145,145,145,145,145,  0,  0,  0,  0,  0,150,150,150],
    [145,145,145,145,354,  0,  0,  0,  0,  0,150,150,150],
    [145, 87, 86,  0,  0,  0,  0,  0,  0,  0,  0, 88,150],
    [145,145,145,145,354,  0,  0,  0,  0,  0,150,150,150],
    [145,145,145,145,145,  0,  0,  0,  0,  0,150,150,150],
    [150,150,150,150,150,150,150,150,150,150,150,150,150],
    [150,150,150,150,150,150,150,150,150,150,150,150,150],
    [173,173,150,150,150,150,150,150,150,173,173,173,173],
    [173,173,173,173,173,173,173,173,173,173,173,173,173]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

]
}