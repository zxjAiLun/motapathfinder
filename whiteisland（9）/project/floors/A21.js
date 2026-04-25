main.floors.A21=
{
    "floorId": "A21",
    "title": "小巷道",
    "name": "小巷道",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 2,
    "defaultGround": 170056,
    "bgm": "3.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "11,0": [
            {
                "type": "choices",
                "text": "可以选择在这里降低难度。\n你将得到10%伤害减免，以及本区域额外福利：\n2攻击，2防御，2黄钥匙，1蓝钥匙。",
                "choices": [
                    {
                        "text": "降低难度",
                        "color": [
                            0,
                            255,
                            125,
                            1
                        ],
                        "action": [
                            {
                                "type": "setValue",
                                "name": "item:I582",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "operator": "+=",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "operator": "+=",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "operator": "+=",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "hide",
                                "remove": true
                            }
                        ]
                    },
                    {
                        "text": "取消",
                        "action": []
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "2,10": {
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
    [144,144,144,144,144,144,144,144,144,144,144, 89,144],
    [144, 22,257,144, 28,144, 21,144, 27,  0,144,  0,144],
    [144,144,  0, 81,  0,258,  0,253,  0,251, 81,  0,144],
    [144, 34,251,  0,254,144, 22,144, 32,  0,144,1006,144],
    [144,144, 82,144,144,144,144,144,144,144,144,251,144],
    [144,  0,252,144, 29,144, 28,144,  0, 81, 31,  0,144],
    [144, 27,  0,144,253,144,252,144,251,144,144,253,144],
    [144,  0, 32,144, 31, 81, 21,  0, 31,144, 32,  0,144],
    [144,254,144,144, 82,144,144,255,144,144, 82,144,144],
    [144,578,  0, 31,254, 21, 81, 31,144,  0,253, 32,144],
    [144,144, 87,  0,144,144,144,  0,256, 30,  0,144,144],
    [144, 30,267, 27,144, 28,252, 30,144,  0,266, 27,144],
    [144,144,144,144,144,144,144,144,144,144,144,144,144]
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