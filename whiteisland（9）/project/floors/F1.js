main.floors.F1=
{
    "floorId": "F1",
    "title": "傀儡庭院",
    "name": "傀儡庭院",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 1,
    "defaultGround": 976,
    "bgm": "2.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "12,11": [
            {
                "type": "choices",
                "text": "可以选择在这里降低难度。\n你将得到10%伤害减免，以及本区域额外福利：\n2防御，2黄钥匙，1蓝钥匙。",
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
        "9,11": {
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
    [918,918,918,918,918,918,918,918,918,918,918,918, 32],
    [918,918,  0, 30,220,  0, 31,918, 32,  0,918, 27, 81],
    [918, 22,212,  0,918, 22,  0,225,  0, 28,209,  0,918],
    [918,918, 82,918,918,206,918,918, 81,918,918, 81,918],
    [918, 21,214,918,  0, 31,206,  0,225, 31,918, 32,918],
    [918,918,  0, 86,225,918,918,214,918,  0,918,  0,918],
    [918, 31,214,918, 28,918, 32,  0,206, 21,220, 29,918],
    [918,918,918,918,918,918, 81,918,918,212,918, 82,918],
    [918, 32,918, 29,  0, 81,  0, 32,918, 81,918, 27,918],
    [918,  0,206,  0, 31,918, 28,  0,225,  0, 32,  0,918],
    [918,217,918,918, 81,918,918,212,918,918,206,918,918],
    [918, 27,  0, 28,209,918, 21,  0,918, 87,  0,  0, 89],
    [918,918,918,918,918,918,918,918,918,918,918,918,918]
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